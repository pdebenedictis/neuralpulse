// Pure checks for the market-data function. Kept separate so they can be
// tested without the Anthropic client or a Netlify runtime.

export const CACHE_TTL_MS = 5 * 60 * 1000;

const DEV_PORTS = ["8888", "5173", "4173", "3000"];

function addOrigin(origins, value) {
  if (!value || typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  try {
    origins.add(new URL(trimmed).origin);
  } catch {
    // Ignore values that are not absolute URLs.
  }
}

export function collectAllowedOrigins({
  siteUrl,
  urls = [],
  requestUrl,
  extra = "",
  dev = false,
} = {}) {
  const origins = new Set();
  addOrigin(origins, siteUrl);
  for (const value of urls) addOrigin(origins, value);
  addOrigin(origins, requestUrl);
  for (const part of String(extra).split(",")) addOrigin(origins, part);
  if (dev) {
    for (const host of ["localhost", "127.0.0.1"]) {
      for (const port of DEV_PORTS) origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

// A present Origin must match. When the browser omits Origin on a same-origin
// GET, the Referer origin is accepted instead. Missing both is rejected.
export function requestOriginAllowed({ origin, referer, allowed }) {
  if (!(allowed instanceof Set) || allowed.size === 0) return false;
  if (origin) return allowed.has(origin);
  if (!referer) return false;
  try {
    return allowed.has(new URL(referer).origin);
  } catch {
    return false;
  }
}

export function marketCacheKey(type, titles) {
  if (type === "stocks" || type === "news") return type;
  if (type !== "summary") return null;
  const normalized = (Array.isArray(titles) ? titles : [])
    .map((title) => String(title).trim())
    .filter(Boolean)
    .join("\n");
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `summary:${(hash >>> 0).toString(16).padStart(8, "0")}:${normalized.length}`;
}

export function cacheEntryFresh(cachedAt, now = Date.now(), ttl = CACHE_TTL_MS) {
  return typeof cachedAt === "number" && Number.isFinite(cachedAt) && now >= cachedAt && now - cachedAt < ttl;
}
