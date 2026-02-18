#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { combinePayloads, extractPayloadFromJson } from "./merge.mjs";

const HELP_TEXT = `tk-proxy - proxy/capture tool for tokscale

Usage:
  tk-proxy --capture [--output <file>] -- <command ...>
  tk-proxy --combine -i <file1> <file2> [more files...] -o <output.json>
  tk-proxy --submit -i <input.json> [--dry-run]

Examples:
  tk-proxy --capture -- tokscale submit --dry-run
  tk-proxy --combine -i host-a.json host-b.json -o combined.json
  tk-proxy --submit -i combined.json
`;

function fatal(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeCommandName(command) {
  return path.basename(command).replace(/\.exe$/i, "").toLowerCase();
}

function isTokscaleSubmitCommand(commandArgs) {
  for (let i = 0; i < commandArgs.length - 1; i += 1) {
    if (normalizeCommandName(commandArgs[i]) === "tokscale" && commandArgs[i + 1] === "submit") {
      return true;
    }
  }
  return false;
}

function buildGraphArgsFromSubmitCommand(commandArgs) {
  const submitIndex = commandArgs.findIndex((value, idx) => {
    if (idx === 0) return false;
    return value === "submit" && normalizeCommandName(commandArgs[idx - 1]) === "tokscale";
  });
  if (submitIndex === -1) return ["graph", "--no-spinner"];

  const rest = commandArgs.slice(submitIndex + 1);
  const graphArgs = ["graph", "--no-spinner"];
  const booleanFlags = new Set([
    "--opencode",
    "--claude",
    "--codex",
    "--gemini",
    "--cursor",
    "--amp",
    "--droid",
    "--openclaw",
    "--pi"
  ]);
  const valueFlags = new Set(["--since", "--until", "--year"]);

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (booleanFlags.has(token)) {
      graphArgs.push(token);
      continue;
    }
    if (valueFlags.has(token)) {
      const value = rest[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${token} in submit command.`);
      }
      graphArgs.push(token, value);
      i += 1;
    }
  }
  return graphArgs;
}

function runCommand(commandArgs, { mirrorOutput }) {
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

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (mirrorOutput) process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
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

async function writeJson(filePath, data) {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return absolute;
}

async function readJson(filePath) {
  const absolute = path.resolve(filePath);
  const content = await fs.readFile(absolute, "utf8");
  const parsed = safeParseJson(content);
  if (!parsed) {
    throw new Error(`File is not valid JSON: ${absolute}`);
  }
  return { absolute, parsed };
}

function defaultCaptureFile() {
  const host = os.hostname().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `tk-capture-${host}-${stampForFilename()}.json`;
}

function defaultCombinedFile() {
  return `tk-combined-${stampForFilename()}.json`;
}

function resolvePayloadOrThrow(data, sourcePath) {
  const payload = extractPayloadFromJson(data);
  if (!payload) {
    throw new Error(`No tokscale payload found in ${sourcePath}`);
  }
  return payload;
}

function parseCaptureArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    fatal("Missing command separator `--` for --capture.");
  }
  const optionTokens = argv.slice(1, separator);
  const commandArgs = argv.slice(separator + 1);
  if (commandArgs.length === 0) {
    fatal("No command provided after -- for --capture.");
  }

  let outputFile = defaultCaptureFile();
  for (let i = 0; i < optionTokens.length; i += 1) {
    const token = optionTokens[i];
    if (token === "-o" || token === "--output") {
      const value = optionTokens[i + 1];
      if (!value) fatal(`Missing value for ${token}.`);
      outputFile = value;
      i += 1;
      continue;
    }
    fatal(`Unknown --capture option: ${token}`);
  }
  return { outputFile, commandArgs };
}

function parseCombineArgs(argv) {
  let outputFile = defaultCombinedFile();
  const inputFiles = [];

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-o" || token === "--output") {
      const value = argv[i + 1];
      if (!value) fatal(`Missing value for ${token}.`);
      outputFile = value;
      i += 1;
      continue;
    }
    if (token === "-i" || token === "--input") {
      let j = i + 1;
      while (j < argv.length && !["-o", "--output"].includes(argv[j])) {
        inputFiles.push(argv[j]);
        j += 1;
      }
      i = j - 1;
      continue;
    }
    fatal(`Unknown --combine option: ${token}`);
  }

  if (inputFiles.length === 0) {
    fatal("No input files supplied. Use --combine -i <file1> <file2> ...");
  }
  return { inputFiles, outputFile };
}

function parseSubmitArgs(argv) {
  let inputFile = "";
  let dryRun = false;
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "-i" || token === "--input") {
      const value = argv[i + 1];
      if (!value) fatal(`Missing value for ${token}.`);
      inputFile = value;
      i += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    fatal(`Unknown --submit option: ${token}`);
  }
  if (!inputFile) {
    fatal("Missing input file. Use --submit -i <file.json>");
  }
  return { inputFile, dryRun };
}

async function handleCapture(argv) {
  const { outputFile, commandArgs } = parseCaptureArgs(argv);
  const startedAt = new Date().toISOString();
  const commandResult = await runCommand(commandArgs, { mirrorOutput: true });
  const endedAt = new Date().toISOString();

  const capture = {
    schemaVersion: "tk-proxy-capture.v1",
    createdAt: endedAt,
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      nodeVersion: process.version
    },
    command: {
      argv: commandArgs,
      cwd: process.cwd(),
      startedAt,
      endedAt,
      exitCode: commandResult.exitCode,
      signal: commandResult.signal
    },
    output: {
      stdout: commandResult.stdout,
      stderr: commandResult.stderr
    }
  };

  capture.parsedStdout = safeParseJson(commandResult.stdout.trim());

  if (isTokscaleSubmitCommand(commandArgs)) {
    try {
      const graphArgs = buildGraphArgsFromSubmitCommand(commandArgs);
      const graphResult = await runCommand(["tokscale", ...graphArgs], { mirrorOutput: false });
      if (graphResult.exitCode === 0) {
        const payload = safeParseJson(graphResult.stdout.trim());
        if (payload) {
          capture.submitPayload = payload;
        } else {
          capture.submitPayloadError = "tokscale graph output was not valid JSON.";
        }
      } else {
        capture.submitPayloadError = `tokscale graph failed with exit code ${graphResult.exitCode}: ${graphResult.stderr.trim()}`;
      }
    } catch (error) {
      capture.submitPayloadError = `Failed to generate submit payload: ${error.message}`;
    }
  }

  const outPath = await writeJson(outputFile, capture);
  console.error(`Capture saved: ${outPath}`);
  process.exit(commandResult.exitCode ?? 0);
}

async function handleCombine(argv) {
  const { inputFiles, outputFile } = parseCombineArgs(argv);
  const payloads = [];
  for (const file of inputFiles) {
    const { absolute, parsed } = await readJson(file);
    payloads.push(resolvePayloadOrThrow(parsed, absolute));
  }
  const combined = combinePayloads(payloads);
  const outPath = await writeJson(outputFile, combined);
  console.log(`Combined ${payloads.length} payloads into ${outPath}`);
  console.log(
    `Summary: ${combined.summary.totalTokens.toLocaleString()} tokens, $${combined.summary.totalCost.toFixed(2)}, ${combined.summary.activeDays} active day(s)`
  );
}

async function readCredentials() {
  const credentialsPath = path.join(os.homedir(), ".config", "tokscale", "credentials.json");
  const content = await fs.readFile(credentialsPath, "utf8");
  const credentials = safeParseJson(content);
  if (!credentials?.token || !credentials?.username) {
    throw new Error(`Invalid credentials file: ${credentialsPath}`);
  }
  return credentials;
}

async function handleSubmit(argv) {
  const { inputFile, dryRun } = parseSubmitArgs(argv);
  const { absolute, parsed } = await readJson(inputFile);
  const payload = resolvePayloadOrThrow(parsed, absolute);

  if (dryRun) {
    console.log("Dry run - not submitting.");
    console.log(
      `Payload summary: ${payload.summary.totalTokens.toLocaleString()} tokens, $${payload.summary.totalCost.toFixed(2)}, ${payload.summary.activeDays} active day(s)`
    );
    return;
  }

  const credentials = await readCredentials();
  const baseUrl = process.env.TOKSCALE_API_URL || "https://tokscale.ai";
  const response = await fetch(`${baseUrl}/api/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.token}`
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  const result = safeParseJson(text) ?? { raw: text };
  if (!response.ok) {
    throw new Error(`Submission failed (${response.status}): ${JSON.stringify(result)}`);
  }

  console.log("Submit success.");
  if (result.submissionId) {
    console.log(`Submission ID: ${result.submissionId}`);
  }
  if (result.metrics) {
    console.log(
      `Server metrics: ${Number(result.metrics.totalTokens || 0).toLocaleString()} tokens, $${Number(result.metrics.totalCost || 0).toFixed(2)}`
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP_TEXT);
    return;
  }

  const mode = argv[0];
  if (mode === "--capture") {
    await handleCapture(argv);
    return;
  }
  if (mode === "--combine") {
    await handleCombine(argv);
    return;
  }
  if (mode === "--submit") {
    await handleSubmit(argv);
    return;
  }
  fatal(`Unknown mode: ${mode}\n\n${HELP_TEXT}`, 2);
}

main().catch((error) => fatal(error.message));
