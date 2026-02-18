import fs from "node:fs/promises";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { combinePayloads, extractPayloadFromJson, type TokenContributionData } from "./merge.js";
import { shouldRunDailySubmit, utcDateString } from "./schedule.js";
import { submitToTokscale } from "./tokscale.js";

const CAPTURE_SCHEMA = "tk-proxy-client-capture.v1";
const STATE_SCHEMA = "tk-proxy-server-state.v1";
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

export interface ServerOptions {
  host: string;
  port: number;
  dataDir: string;
  submitHourUtc: number;
  authToken: string | null;
  noAuth: boolean;
  checkIntervalMs: number;
  dryRunSubmit: boolean;
}

interface CaptureUploadBody {
  clientId?: unknown;
  capturedAt?: unknown;
  payload?: unknown;
  sourceHost?: unknown;
}

interface StoredClientCapture {
  schemaVersion: string;
  clientId: string;
  capturedAt: string;
  receivedAt: string;
  sourceHost: string | null;
  payload: TokenContributionData;
}

interface ServerState {
  schemaVersion: string;
  lastSubmittedDate: string | null;
  lastSubmittedAt: string | null;
  lastSubmitError: string | null;
  lastSubmissionId: string | null;
}

function defaultState(): ServerState {
  return {
    schemaVersion: STATE_SCHEMA,
    lastSubmittedDate: null,
    lastSubmittedAt: null,
    lastSubmitError: null,
    lastSubmissionId: null
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sanitizeClientId(clientId: string): string {
  const normalized = clientId.trim();
  if (!normalized) throw new Error("clientId must not be empty");
  return normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function clientsDir(dataDir: string): string {
  return path.join(dataDir, "clients");
}

function stateFile(dataDir: string): string {
  return path.join(dataDir, "state.json");
}

function submissionsDir(dataDir: string): string {
  return path.join(dataDir, "submissions");
}

async function ensureDataDir(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(clientsDir(dataDir), { recursive: true });
  await fs.mkdir(submissionsDir(dataDir), { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const tempPath = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, absolute);
}

async function readState(dataDir: string): Promise<ServerState> {
  try {
    const content = await fs.readFile(stateFile(dataDir), "utf8");
    const parsed = JSON.parse(content) as Partial<ServerState>;
    if (parsed && typeof parsed === "object") {
      return {
        schemaVersion: STATE_SCHEMA,
        lastSubmittedDate: parsed.lastSubmittedDate ?? null,
        lastSubmittedAt: parsed.lastSubmittedAt ?? null,
        lastSubmitError: parsed.lastSubmitError ?? null,
        lastSubmissionId: parsed.lastSubmissionId ?? null
      };
    }
    return defaultState();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return defaultState();
    throw error;
  }
}

async function writeState(dataDir: string, state: ServerState): Promise<void> {
  await writeJsonAtomic(stateFile(dataDir), state);
}

async function readClientCaptureFiles(dataDir: string): Promise<StoredClientCapture[]> {
  const dir = clientsDir(dataDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const captures: StoredClientCapture[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(content) as StoredClientCapture;
      if (parsed && parsed.clientId && parsed.payload) captures.push(parsed);
    } catch {
      continue;
    }
  }
  captures.sort((a, b) => a.clientId.localeCompare(b.clientId));
  return captures;
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = `${JSON.stringify(data)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new Error(`Request body too large (max ${maxBytes} bytes)`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function getBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function assertAuthorized(req: IncomingMessage, token: string | null, noAuth: boolean): void {
  if (noAuth) return;
  if (!token) {
    throw new Error("Unauthorized");
  }
  const provided = getBearerToken(req);
  if (!provided || provided !== token) {
    throw new Error("Unauthorized");
  }
}

function parseUpload(body: string): { clientId: string; capturedAt: string; payload: TokenContributionData; sourceHost: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object");
  }
  const upload = parsed as CaptureUploadBody;
  const clientIdRaw = typeof upload.clientId === "string" ? upload.clientId : "";
  if (!clientIdRaw.trim()) {
    throw new Error("clientId is required");
  }
  const payload = extractPayloadFromJson(upload.payload ?? parsed);
  if (!payload) {
    throw new Error("payload is required and must be a tokscale contribution payload");
  }
  const capturedAt = typeof upload.capturedAt === "string" && upload.capturedAt.trim() ? upload.capturedAt : new Date().toISOString();
  const sourceHost = typeof upload.sourceHost === "string" && upload.sourceHost.trim() ? upload.sourceHost.trim() : null;
  return {
    clientId: sanitizeClientId(clientIdRaw),
    capturedAt,
    payload,
    sourceHost
  };
}

async function writeClientCapture(dataDir: string, data: { clientId: string; capturedAt: string; payload: TokenContributionData; sourceHost: string | null }): Promise<void> {
  const record: StoredClientCapture = {
    schemaVersion: CAPTURE_SCHEMA,
    clientId: data.clientId,
    capturedAt: data.capturedAt,
    receivedAt: new Date().toISOString(),
    sourceHost: data.sourceHost,
    payload: data.payload
  };
  const filePath = path.join(clientsDir(dataDir), `${data.clientId}.json`);
  await writeJsonAtomic(filePath, record);
}

async function writeSubmissionRecord(
  dataDir: string,
  date: string,
  payload: TokenContributionData,
  submitResult: { mode: "dry-run" | "submit"; response: unknown }
): Promise<void> {
  const filePath = path.join(submissionsDir(dataDir), `${date}.json`);
  await writeJsonAtomic(filePath, {
    schemaVersion: "tk-proxy-submission.v1",
    submittedDate: date,
    createdAt: new Date().toISOString(),
    result: submitResult,
    payload
  });
}

export async function runServer(options: ServerOptions): Promise<void> {
  await ensureDataDir(options.dataDir);
  let state = await readState(options.dataDir);
  let submitInProgress = false;

  const maybeSubmit = async (): Promise<void> => {
    if (submitInProgress) return;
    const now = new Date();
    if (!shouldRunDailySubmit(now, state.lastSubmittedDate, options.submitHourUtc)) return;

    submitInProgress = true;
    try {
      const captures = await readClientCaptureFiles(options.dataDir);
      if (captures.length === 0) {
        throw new Error("No client captures available");
      }
      const payload = combinePayloads(captures.map((item) => item.payload));
      const date = utcDateString(now);

      if (options.dryRunSubmit) {
        await writeSubmissionRecord(options.dataDir, date, payload, {
          mode: "dry-run",
          response: {
            summary: payload.summary
          }
        });
        state = {
          ...state,
          lastSubmittedDate: date,
          lastSubmittedAt: new Date().toISOString(),
          lastSubmitError: null,
          lastSubmissionId: null
        };
        await writeState(options.dataDir, state);
        console.log(`[server] dry-run submit complete for ${date}`);
        return;
      }

      const submission = await submitToTokscale(payload);
      await writeSubmissionRecord(options.dataDir, date, payload, {
        mode: "submit",
        response: submission.response
      });
      state = {
        ...state,
        lastSubmittedDate: date,
        lastSubmittedAt: new Date().toISOString(),
        lastSubmitError: null,
        lastSubmissionId: submission.response.submissionId ?? null
      };
      await writeState(options.dataDir, state);
      console.log(`[server] submit complete for ${date}`);
    } catch (error) {
      const message = `[${new Date().toISOString()}] ${toErrorMessage(error)}`;
      state = {
        ...state,
        lastSubmitError: message
      };
      await writeState(options.dataDir, state);
      console.error(`[server] submit failed: ${message}`);
    } finally {
      submitInProgress = false;
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true, now: new Date().toISOString() });
        return;
      }

      if (method === "GET" && url.pathname === "/status") {
        assertAuthorized(req, options.authToken, options.noAuth);
        const captures = await readClientCaptureFiles(options.dataDir);
        sendJson(res, 200, {
          ok: true,
          now: new Date().toISOString(),
          authEnabled: !options.noAuth,
          submitHourUtc: options.submitHourUtc,
          lastSubmittedDate: state.lastSubmittedDate,
          lastSubmittedAt: state.lastSubmittedAt,
          lastSubmitError: state.lastSubmitError,
          lastSubmissionId: state.lastSubmissionId,
          clients: captures.map((capture) => ({
            clientId: capture.clientId,
            capturedAt: capture.capturedAt,
            receivedAt: capture.receivedAt,
            sourceHost: capture.sourceHost
          }))
        });
        return;
      }

      if (method === "POST" && url.pathname === "/v1/captures") {
        assertAuthorized(req, options.authToken, options.noAuth);
        const body = await readRequestBody(req, MAX_REQUEST_BYTES);
        const upload = parseUpload(body);
        await writeClientCapture(options.dataDir, upload);
        sendJson(res, 202, {
          ok: true,
          clientId: upload.clientId,
          receivedAt: new Date().toISOString()
        });
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = toErrorMessage(error);
      const status = message === "Unauthorized" ? 401 : 400;
      sendJson(res, status, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  console.log(`[server] listening on http://${options.host}:${options.port}`);
  void maybeSubmit();
  const timer = setInterval(() => {
    void maybeSubmit();
  }, options.checkIntervalMs);

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  clearInterval(timer);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
