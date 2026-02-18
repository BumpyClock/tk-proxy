import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { TokenContributionData } from "./merge.js";

export interface CommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

interface TokscaleCredentials {
  token: string;
  username: string;
}

export interface TokscaleSubmitResponse {
  submissionId?: string;
  metrics?: {
    totalTokens?: number;
    totalCost?: number;
  };
  raw?: string;
}

export function safeParseJson<T = unknown>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function runCommand(commandArgs: string[], mirrorOutput: boolean): Promise<CommandResult> {
  return new Promise((resolve) => {
    const [command, ...args] = commandArgs;
    const child = spawn(command, args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
      cwd: process.cwd(),
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (mirrorOutput) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (mirrorOutput) process.stderr.write(text);
    });

    child.on("error", (error) => {
      resolve({
        exitCode: 127,
        signal: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim()
      });
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode: exitCode ?? 0,
        signal,
        stdout,
        stderr
      });
    });
  });
}

export async function runTokscaleGraph(extraArgs: string[] = []): Promise<TokenContributionData> {
  const args = ["tokscale", "graph", "--no-spinner", ...extraArgs];
  const result = await runCommand(args, false);
  if (result.exitCode !== 0) {
    throw new Error(`tokscale graph failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
  }
  const parsed = safeParseJson<TokenContributionData>(result.stdout.trim());
  if (!parsed) {
    throw new Error("tokscale graph output was not valid JSON");
  }
  return parsed;
}

export async function readTokscaleCredentials(): Promise<TokscaleCredentials> {
  const credentialsPath = path.join(os.homedir(), ".config", "tokscale", "credentials.json");
  const content = await fs.readFile(credentialsPath, "utf8");
  const credentials = safeParseJson<{ token?: string; username?: string }>(content);
  if (!credentials?.token || !credentials?.username) {
    throw new Error(`Invalid credentials file: ${credentialsPath}`);
  }
  return { token: credentials.token, username: credentials.username };
}

export async function submitToTokscale(
  payload: TokenContributionData
): Promise<{ response: TokscaleSubmitResponse; status: number }> {
  const credentials = await readTokscaleCredentials();
  const baseUrl = process.env.TOKSCALE_API_URL || "https://tokscale.ai";
  const httpResponse = await fetch(`${baseUrl}/api/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.token}`
    },
    body: JSON.stringify(payload)
  });

  const text = await httpResponse.text();
  const response = safeParseJson<TokscaleSubmitResponse>(text) ?? { raw: text };
  if (!httpResponse.ok) {
    throw new Error(`Submission failed (${httpResponse.status}): ${JSON.stringify(response)}`);
  }
  return { response, status: httpResponse.status };
}
