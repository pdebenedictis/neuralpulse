// Caller checks for checkPriceAlerts. Admin sessions may run a check.
// The scheduled workflow may run a check only when it presents the shared
// scheduler secret. The secret itself is never stored in this file.

const MAX_TOKEN_LENGTH = 256;

export function isAdminUser(user) {
  return Boolean(user && user.role === "admin");
}

export function tokensMatch(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  if (presented.length === 0 || presented.length > MAX_TOKEN_LENGTH) return false;
  if (expected.length === 0 || expected.length > MAX_TOKEN_LENGTH) return false;
  const a = new TextEncoder().encode(presented);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function presentedSchedulerToken(headerValue, body) {
  if (typeof headerValue === "string" && headerValue.trim()) return headerValue.trim();
  if (!body || typeof body !== "object") return "";
  const direct = body.scheduler_token;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = body.args && typeof body.args === "object" ? body.args.scheduler_token : undefined;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return "";
}

export function callerMayCheckAlerts({ user, presentedToken, schedulerSecret }) {
  if (isAdminUser(user)) return true;
  return tokensMatch(presentedToken, schedulerSecret);
}
