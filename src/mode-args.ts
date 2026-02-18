import os from "node:os";
import { randomBytes } from "node:crypto";
import { parseDurationMs } from "./schedule.js";

export interface ServerModeArgs {
  host: string;
  port: number;
  dataDir: string;
  submitHourUtc: number;
  authToken: string | null;
  authTokenGenerated: boolean;
  noAuth: boolean;
  checkIntervalMs: number;
  dryRunSubmit: boolean;
}

export interface ClientModeArgs {
  serverUrl: string;
  clientId: string;
  intervalMs: number;
  jitterMs: number;
  authToken: string | null;
  noAuth: boolean;
  once: boolean;
  requestTimeoutMs: number;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer for ${flag}: ${value}`);
  }
  return parsed;
}

export function parseServerModeArgs(argv: string[]): ServerModeArgs {
  let host = "0.0.0.0";
  let port = 8787;
  let dataDir = ".tk-proxy";
  let submitHourUtc = 2;
  let authToken = process.env.TK_PROXY_AUTH_TOKEN ?? "";
  let authTokenGenerated = false;
  let noAuth = false;
  let checkIntervalMs = parseDurationMs("10m");
  let dryRunSubmit = false;

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--host") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --host");
      host = value;
      i += 1;
      continue;
    }
    if (token === "--port") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --port");
      port = parseInteger(value, "--port");
      i += 1;
      continue;
    }
    if (token === "--data-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --data-dir");
      dataDir = value;
      i += 1;
      continue;
    }
    if (token === "--submit-hour-utc") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --submit-hour-utc");
      submitHourUtc = parseInteger(value, "--submit-hour-utc");
      i += 1;
      continue;
    }
    if (token === "--auth-token") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --auth-token");
      authToken = value;
      i += 1;
      continue;
    }
    if (token === "--no-auth") {
      noAuth = true;
      continue;
    }
    if (token === "--check-interval") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --check-interval");
      checkIntervalMs = parseDurationMs(value);
      i += 1;
      continue;
    }
    if (token === "--dry-run-submit") {
      dryRunSubmit = true;
      continue;
    }
    throw new Error(`Unknown --server option: ${token}`);
  }

  if (submitHourUtc < 0 || submitHourUtc > 23) {
    throw new Error(`--submit-hour-utc must be between 0 and 23: ${submitHourUtc}`);
  }
  if (port < 1 || port > 65535) {
    throw new Error(`--port must be between 1 and 65535: ${port}`);
  }

  if (noAuth) {
    authToken = "";
  }
  if (!noAuth && !authToken) {
    authToken = randomBytes(24).toString("hex");
    authTokenGenerated = true;
  }
  if (!noAuth && authToken) {
    process.env.TK_PROXY_AUTH_TOKEN = authToken;
  }

  return {
    host,
    port,
    dataDir,
    submitHourUtc,
    authToken: noAuth ? null : authToken,
    authTokenGenerated,
    noAuth,
    checkIntervalMs,
    dryRunSubmit
  };
}

export function parseClientModeArgs(argv: string[]): ClientModeArgs {
  const serverUrl = argv[1];
  if (!serverUrl) {
    throw new Error("Missing server URL. Usage: --client <server-url>");
  }

  let clientId = os.hostname();
  let intervalMs = parseDurationMs("4h");
  let jitterMs = parseDurationMs("1h");
  let authToken = process.env.TK_PROXY_AUTH_TOKEN ?? "";
  let noAuth = false;
  let once = false;
  let requestTimeoutMs = parseDurationMs("30s");

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--client-id") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --client-id");
      clientId = value;
      i += 1;
      continue;
    }
    if (token === "--interval") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --interval");
      intervalMs = parseDurationMs(value);
      i += 1;
      continue;
    }
    if (token === "--jitter") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --jitter");
      jitterMs = parseDurationMs(value);
      i += 1;
      continue;
    }
    if (token === "--auth-token") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --auth-token");
      authToken = value;
      i += 1;
      continue;
    }
    if (token === "--no-auth") {
      noAuth = true;
      continue;
    }
    if (token === "--once") {
      once = true;
      continue;
    }
    if (token === "--request-timeout") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --request-timeout");
      requestTimeoutMs = parseDurationMs(value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown --client option: ${token}`);
  }

  if (!noAuth && !authToken) {
    throw new Error("Missing auth token. Set --auth-token or TK_PROXY_AUTH_TOKEN");
  }

  return {
    serverUrl,
    clientId,
    intervalMs,
    jitterMs,
    authToken: noAuth ? null : authToken,
    noAuth,
    once,
    requestTimeoutMs
  };
}
