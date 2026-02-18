import os from "node:os";
import { computeWaitWithJitterMs, sleep } from "./schedule.js";
import { runTokscaleGraph } from "./tokscale.js";

export interface ClientOptions {
  serverUrl: string;
  clientId: string;
  intervalMs: number;
  jitterMs: number;
  authToken: string | null;
  noAuth: boolean;
  once: boolean;
  requestTimeoutMs: number;
}

interface UploadBody {
  clientId: string;
  capturedAt: string;
  sourceHost: string;
  payload: unknown;
}

function normalizeBaseUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Server URL must be http or https: ${serverUrl}`);
  }
  return url.toString().replace(/\/$/, "");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function uploadCapture(baseUrl: string, token: string | null, noAuth: boolean, body: UploadBody, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (!noAuth && token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const response = await fetch(`${baseUrl}/v1/captures`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Upload failed (${response.status}): ${text}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function runClient(options: ClientOptions): Promise<void> {
  const baseUrl = normalizeBaseUrl(options.serverUrl);
  let shouldStop = false;

  const requestStop = (): void => {
    shouldStop = true;
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  console.log(
    `[client] starting with server=${baseUrl} clientId=${options.clientId} intervalMs=${options.intervalMs} jitterMs=${options.jitterMs} authEnabled=${!options.noAuth}`
  );

  while (!shouldStop) {
    const startedAt = new Date();
    try {
      const payload = await runTokscaleGraph();
      await uploadCapture(
        baseUrl,
        options.authToken,
        options.noAuth,
        {
          clientId: options.clientId,
          capturedAt: startedAt.toISOString(),
          sourceHost: os.hostname(),
          payload
        },
        options.requestTimeoutMs
      );
      console.log(`[client] uploaded capture at ${startedAt.toISOString()}`);
    } catch (error) {
      console.error(`[client] capture/upload failed: ${toErrorMessage(error)}`);
    }

    if (options.once) break;
    const waitMs = computeWaitWithJitterMs(options.intervalMs, options.jitterMs);
    await sleep(waitMs);
  }
}
