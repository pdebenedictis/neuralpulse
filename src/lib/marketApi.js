// Client for the standalone backend (Netlify function -> Claude API).
// Replaces the old base44.integrations.Core.InvokeLLM calls.

const ENDPOINT = "/api/market-data";

async function call(type, opts = {}) {
  const res = await fetch(`${ENDPOINT}?type=${type}`, opts);
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(`market-data ${type} failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

export async function fetchStocks() {
  const data = await call("stocks");
  return data.stocks || [];
}

export async function fetchNews() {
  const data = await call("news");
  return data.articles || [];
}

export async function summarizeNews(titles) {
  const data = await call("summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ titles }),
  });
  return data.bullets || [];
}
