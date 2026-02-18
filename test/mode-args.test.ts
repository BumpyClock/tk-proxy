import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { parseClientModeArgs, parseServerModeArgs } from "../src/mode-args.js";

const ORIGINAL_TOKEN = process.env.TK_PROXY_AUTH_TOKEN;

function restoreEnv(): void {
  if (ORIGINAL_TOKEN === undefined) {
    delete process.env.TK_PROXY_AUTH_TOKEN;
    return;
  }
  process.env.TK_PROXY_AUTH_TOKEN = ORIGINAL_TOKEN;
}

afterEach(() => {
  restoreEnv();
});

test("parseServerModeArgs auto-generates token when auth is enabled and token is missing", () => {
  delete process.env.TK_PROXY_AUTH_TOKEN;
  const parsed = parseServerModeArgs(["--server"]);
  assert.equal(parsed.noAuth, false);
  assert.equal(parsed.authTokenGenerated, true);
  assert.ok(parsed.authToken);
  assert.equal(process.env.TK_PROXY_AUTH_TOKEN, parsed.authToken);
});

test("parseServerModeArgs supports --no-auth without requiring token", () => {
  delete process.env.TK_PROXY_AUTH_TOKEN;
  const parsed = parseServerModeArgs(["--server", "--no-auth"]);
  assert.equal(parsed.noAuth, true);
  assert.equal(parsed.authTokenGenerated, false);
  assert.equal(parsed.authToken, null);
});

test("parseClientModeArgs supports --no-auth without requiring token", () => {
  delete process.env.TK_PROXY_AUTH_TOKEN;
  const parsed = parseClientModeArgs(["--client", "http://127.0.0.1:8787", "--no-auth"]);
  assert.equal(parsed.noAuth, true);
  assert.equal(parsed.authToken, null);
});

test("parseClientModeArgs requires token unless --no-auth is used", () => {
  delete process.env.TK_PROXY_AUTH_TOKEN;
  assert.throws(() => parseClientModeArgs(["--client", "http://127.0.0.1:8787"]));
});
