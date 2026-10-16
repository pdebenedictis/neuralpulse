import assert from "node:assert/strict";
import test from "node:test";
import {
  CACHE_TTL_MS,
  cacheEntryFresh,
  collectAllowedOrigins,
  marketCacheKey,
  requestOriginAllowed,
} from "../netlify/functions/_shared/market-guard.js";

test("allowlist includes the site, the request, and extra origins", () => {
  const allowed = collectAllowedOrigins({
    siteUrl: "https://neuralpulse.netlify.app",
    urls: ["https://deploy-preview-3--neuralpulse.netlify.app/dashboard"],
    requestUrl: "https://neuralpulse.netlify.app/api/market-data?type=stocks",
    extra: "https://markets.example.com, not a url",
  });
  assert.equal(requestOriginAllowed({
    origin: "https://neuralpulse.netlify.app",
    referer: null,
    allowed,
  }), true);
  assert.equal(requestOriginAllowed({
    origin: "https://deploy-preview-3--neuralpulse.netlify.app",
    referer: null,
    allowed,
  }), true);
  assert.equal(requestOriginAllowed({
    origin: "https://markets.example.com",
    referer: null,
    allowed,
  }), true);
  assert.equal(requestOriginAllowed({
    origin: "https://evil.example",
    referer: "https://neuralpulse.netlify.app/",
    allowed,
  }), false);
});

test("a missing Origin can fall back to a same-site Referer", () => {
  const allowed = collectAllowedOrigins({
    requestUrl: "https://neuralpulse.netlify.app/api/market-data",
  });
  assert.equal(requestOriginAllowed({
    origin: null,
    referer: "https://neuralpulse.netlify.app/dashboard",
    allowed,
  }), true);
  assert.equal(requestOriginAllowed({ origin: null, referer: null, allowed }), false);
  assert.equal(requestOriginAllowed({
    origin: null,
    referer: "https://evil.example/dashboard",
    allowed,
  }), false);
});

test("an empty allowlist rejects every caller", () => {
  const allowed = collectAllowedOrigins();
  assert.equal(allowed.size, 0);
  assert.equal(requestOriginAllowed({
    origin: "https://neuralpulse.netlify.app",
    referer: null,
    allowed,
  }), false);
});

test("dev mode allows local Netlify and Vite origins only", () => {
  const prod = collectAllowedOrigins({ dev: false });
  const dev = collectAllowedOrigins({ dev: true });
  assert.equal(prod.has("http://localhost:8888"), false);
  assert.equal(dev.has("http://localhost:8888"), true);
  assert.equal(dev.has("http://127.0.0.1:5173"), true);
});

test("cache keys are stable and summary keys follow the titles", () => {
  assert.equal(marketCacheKey("stocks"), "stocks");
  assert.equal(marketCacheKey("news"), "news");
  assert.equal(marketCacheKey("other"), null);
  const first = marketCacheKey("summary", [" NVDA rises ", ""]);
  const second = marketCacheKey("summary", ["NVDA rises"]);
  const third = marketCacheKey("summary", ["AMD falls"]);
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test("cache entries expire after five minutes", () => {
  const now = 1_700_000_000_000;
  assert.equal(cacheEntryFresh(now - CACHE_TTL_MS + 1, now), true);
  assert.equal(cacheEntryFresh(now - CACHE_TTL_MS, now), false);
  assert.equal(cacheEntryFresh(now + 1, now), false);
  assert.equal(cacheEntryFresh("now", now), false);
});
