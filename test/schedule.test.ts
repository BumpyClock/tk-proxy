import assert from "node:assert/strict";
import test from "node:test";
import { parseDurationMs, shouldRunDailySubmit } from "../src/schedule.js";

test("parseDurationMs parses hour and minute values", () => {
  assert.equal(parseDurationMs("5h"), 5 * 60 * 60 * 1000);
  assert.equal(parseDurationMs("15m"), 15 * 60 * 1000);
  assert.equal(parseDurationMs("45s"), 45 * 1000);
  assert.equal(parseDurationMs("2d"), 2 * 24 * 60 * 60 * 1000);
});

test("parseDurationMs rejects invalid or zero values", () => {
  assert.throws(() => parseDurationMs("0h"));
  assert.throws(() => parseDurationMs("-2h"));
  assert.throws(() => parseDurationMs("12"));
  assert.throws(() => parseDurationMs("abc"));
});

test("shouldRunDailySubmit waits for the configured utc hour", () => {
  const now = new Date("2026-02-18T01:30:00.000Z");
  assert.equal(shouldRunDailySubmit(now, null, 2), false);
});

test("shouldRunDailySubmit runs once after the configured utc hour", () => {
  const now = new Date("2026-02-18T03:30:00.000Z");
  assert.equal(shouldRunDailySubmit(now, null, 2), true);
  assert.equal(shouldRunDailySubmit(now, "2026-02-18", 2), false);
});

test("shouldRunDailySubmit skips next day until hour then runs", () => {
  const beforeHour = new Date("2026-02-19T00:30:00.000Z");
  const atHour = new Date("2026-02-19T02:00:00.000Z");
  assert.equal(shouldRunDailySubmit(beforeHour, "2026-02-18", 2), false);
  assert.equal(shouldRunDailySubmit(atHour, "2026-02-18", 2), true);
});
