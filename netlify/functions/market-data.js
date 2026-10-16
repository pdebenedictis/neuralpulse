import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import {
  cacheEntryFresh,
  collectAllowedOrigins,
  marketCacheKey,
  requestOriginAllowed,
} from "./_shared/market-guard.js";

// Fast, low-cost model. Results are cached so a dashboard refresh does not
// call Claude again within the cache window.
const MODEL = "claude-haiku-4-5-20251001";
const CACHE_STORE = "market-data";

const AI_STOCKS = [
  "NVDA", "MSFT", "GOOGL", "META", "AMZN", "AMD", "INTC",
  "PLTR", "CRM", "SNOW", "AI", "SMCI", "AVGO", "ORCL",
];

function env(name) {
  if (typeof Netlify === "undefined" || !Netlify.env?.get) return undefined;
  return Netlify.env.get(name) || undefined;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}

function allowedOrigins(req, context) {
  return collectAllowedOrigins({
    siteUrl: context?.site?.url,
    urls: [env("URL"), env("DEPLOY_PRIME_URL"), env("DEPLOY_URL")],
    requestUrl: req.url,
    extra: env("ALLOWED_ORIGINS") || "",
    dev: env("CONTEXT") === "dev" || env("NETLIFY_DEV") === "true",
  });
}

function originAllowed(req, context) {
  return requestOriginAllowed({
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    allowed: allowedOrigins(req, context),
  });
}

async function readCache(key) {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "strong" });
    const entry = await store.get(key, { type: "json" });
    if (!entry || !cacheEntryFresh(entry.cachedAt)) return null;
    return entry.body ?? null;
  } catch (error) {
    console.error("market-data cache read failed:", error?.name || "error");
    return null;
  }
}

async function writeCache(key, body) {
  try {
    const store = getStore({ name: CACHE_STORE, consistency: "strong" });
    await store.setJSON(key, { cachedAt: Date.now(), body });
  } catch (error) {
    console.error("market-data cache write failed:", error?.name || "error");
  }
}

// Force a schema-valid JSON response via tool use.
async function structured(client, { prompt, toolName, schema, maxTokens = 3072 }) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    tools: [{ name: toolName, description: "Return the requested structured data.", input_schema: schema }],
    tool_choice: { type: "tool", name: toolName },
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content.find((c) => c.type === "tool_use");
  if (!block) throw new Error("Model did not return structured data");
  return block.input;
}

async function loadPayload(client, type, titles) {
  if (type === "stocks") {
    const data = await structured(client, {
      toolName: "return_stocks",
      maxTokens: 3072,
      prompt:
        `You are a financial data assistant. Provide current, realistic approximate stock data for these ` +
        `AI-related companies: ${AI_STOCKS.join(", ")}.\n` +
        `For each: symbol, name (full company name), price (USD), change (today's dollar change, may be ` +
        `negative), change_percent (percent, may be negative), market_cap (e.g. "3.2T" or "450B"), ` +
        `volume (e.g. "45M" or "1.2B"). Make values realistic and internally consistent.`,
      schema: {
        type: "object",
        properties: {
          stocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                symbol: { type: "string" },
                name: { type: "string" },
                price: { type: "number" },
                change: { type: "number" },
                change_percent: { type: "number" },
                market_cap: { type: "string" },
                volume: { type: "string" },
              },
              required: ["symbol", "name", "price", "change", "change_percent", "market_cap", "volume"],
            },
          },
        },
        required: ["stocks"],
      },
    });
    const stocks = (data.stocks || []).map((s) => ({
      ...s,
      buy_url: `https://robinhood.com/stocks/${s.symbol}`,
    }));
    return { stocks };
  }

  if (type === "news") {
    const data = await structured(client, {
      toolName: "return_news",
      maxTokens: 4096,
      prompt:
        `You are an AI news aggregator. Provide 10 important, recent-sounding AI-related news stories ` +
        `spanning: company earnings & announcements (OpenAI, Google, Microsoft, NVIDIA, Meta, etc.), ` +
        `AI regulation/policy, new model releases & breakthroughs, industry deals/partnerships, and AI ` +
        `stock movements.\nFor each: title (compelling headline), summary (2-3 sentences), source (outlet ` +
        `name such as Reuters, Bloomberg, CNBC, TechCrunch, The Verge), category (exactly one of: ` +
        `Earnings, Regulation, AI Chips, LLM Software, Markets, Deals, Research), time_ago (e.g. "2h ago").`,
      schema: {
        type: "object",
        properties: {
          articles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                summary: { type: "string" },
                source: { type: "string" },
                category: { type: "string" },
                time_ago: { type: "string" },
              },
              required: ["title", "summary", "source", "category", "time_ago"],
            },
          },
        },
        required: ["articles"],
      },
    });
    return { articles: data.articles || [] };
  }

  if (type === "summary") {
    if (!titles.length) return { bullets: [] };
    const data = await structured(client, {
      toolName: "return_summary",
      maxTokens: 1024,
      prompt:
        `Here are today's top AI news headlines:\n${titles.join("\n")}\n\n` +
        `Summarize the 3 most important stories into concise, punchy bullet points (1 sentence each). ` +
        `Focus on what matters most to an investor or tech enthusiast.`,
      schema: {
        type: "object",
        properties: { bullets: { type: "array", items: { type: "string" } } },
        required: ["bullets"],
      },
    });
    return { bullets: data.bullets || [] };
  }

  return null;
}

async function readTitles(req) {
  if (req.method !== "POST") return [];
  try {
    const body = await req.json();
    return Array.isArray(body?.titles) ? body.titles.map((title) => String(title)).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export default async (req, context) => {
  if (!originAllowed(req, context)) {
    return json(403, { error: "Forbidden" });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "cache-control": "private, no-store" } });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const type = new URL(req.url).searchParams.get("type");
  const titles = type === "summary" ? await readTitles(req) : [];
  const cacheKey = marketCacheKey(type, titles);
  if (!cacheKey) {
    return json(400, { error: "Unknown type. Use ?type=stocks|news|summary" });
  }

  if (!(type === "summary" && titles.length === 0)) {
    const cached = await readCache(cacheKey);
    if (cached) return json(200, cached);
  }

  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(500, { error: "ANTHROPIC_API_KEY is not set on the server." });
  }

  try {
    const payload = await loadPayload(new Anthropic({ apiKey }), type, titles);
    if (!payload) return json(400, { error: "Unknown type. Use ?type=stocks|news|summary" });
    if (!(type === "summary" && titles.length === 0)) {
      await writeCache(cacheKey, payload);
    }
    return json(200, payload);
  } catch (error) {
    console.error("market-data error:", error?.name || "error");
    return json(502, { error: "Upstream model error" });
  }
};

// `path` is required for the rate limit to be applied. The limit is per
// visitor (IP + domain): 20 requests per 60 seconds. Netlify enforces it
// before this handler runs.
export const config = {
  path: "/api/market-data",
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
