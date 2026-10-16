import assert from "node:assert/strict";
import test from "node:test";
import handler, { config } from "../netlify/functions/market-data.js";

test("the function rate limit is declared on a path", () => {
  assert.equal(config.path, "/api/market-data");
  assert.deepEqual(config.rateLimit, {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  });
});

test("a foreign origin is rejected before any model call", async () => {
  const response = await handler(new Request("https://neuralpulse.netlify.app/api/market-data?type=stocks", {
    headers: { origin: "https://evil.example" },
  }), { site: { url: "https://neuralpulse.netlify.app" } });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Forbidden" });
});

test("a request with no origin or referer is rejected", async () => {
  const response = await handler(new Request("https://neuralpulse.netlify.app/api/market-data?type=news"), {
    site: { url: "https://neuralpulse.netlify.app" },
  });
  assert.equal(response.status, 403);
});

test("a same-site referer is accepted when Origin is omitted", async () => {
  const response = await handler(new Request("https://neuralpulse.netlify.app/api/market-data?type=news", {
    headers: { referer: "https://neuralpulse.netlify.app/dashboard" },
  }), { site: { url: "https://neuralpulse.netlify.app" } });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "ANTHROPIC_API_KEY is not set on the server.");
});

test("an allowed origin does not call the model when the API key is absent", async () => {
  const response = await handler(new Request("https://neuralpulse.netlify.app/api/market-data?type=stocks", {
    headers: { origin: "https://neuralpulse.netlify.app" },
  }), { site: { url: "https://neuralpulse.netlify.app" } });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "ANTHROPIC_API_KEY is not set on the server.");
});
