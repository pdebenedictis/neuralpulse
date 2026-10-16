import assert from "node:assert/strict";
import test from "node:test";
import {
  callerMayCheckAlerts,
  presentedSchedulerToken,
  tokensMatch,
} from "../base44/functions/checkPriceAlerts/authorize.js";

const SECRET = "scheduler-secret-value";

test("admins may run the check without the scheduler secret", () => {
  assert.equal(callerMayCheckAlerts({
    user: { role: "admin" },
    presentedToken: "",
    schedulerSecret: undefined,
  }), true);
});

test("the scheduler token allows a non-admin, and everyone else is rejected", () => {
  assert.equal(callerMayCheckAlerts({
    user: { role: "user" },
    presentedToken: SECRET,
    schedulerSecret: SECRET,
  }), true);
  assert.equal(callerMayCheckAlerts({
    user: { role: "user" },
    presentedToken: "wrong",
    schedulerSecret: SECRET,
  }), false);
  assert.equal(callerMayCheckAlerts({
    user: null,
    presentedToken: "",
    schedulerSecret: SECRET,
  }), false);
  assert.equal(callerMayCheckAlerts({
    user: null,
    presentedToken: SECRET,
    schedulerSecret: undefined,
  }), false);
});

test("token comparison rejects empty, mismatched, and oversized values", () => {
  assert.equal(tokensMatch("", SECRET), false);
  assert.equal(tokensMatch(SECRET, ""), false);
  assert.equal(tokensMatch(`${SECRET}x`, SECRET), false);
  assert.equal(tokensMatch("a".repeat(257), "a".repeat(257)), false);
  assert.equal(tokensMatch(SECRET, SECRET), true);
});

test("the scheduler token is read from the header or the workflow args", () => {
  assert.equal(presentedSchedulerToken(`  ${SECRET}  `, {}), SECRET);
  assert.equal(presentedSchedulerToken("", { scheduler_token: SECRET }), SECRET);
  assert.equal(presentedSchedulerToken(null, { args: { scheduler_token: SECRET } }), SECRET);
  assert.equal(presentedSchedulerToken("", {}), "");
});
