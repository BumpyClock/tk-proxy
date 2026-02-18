import { mkdir, rm } from "node:fs/promises";

const OUTPUT_BASENAME = "./bin/tk-proxy";
const CANDIDATE_OUTPUTS = [OUTPUT_BASENAME, `${OUTPUT_BASENAME}.exe`];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeWithRetry(filePath: string): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(filePath, { force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      if (code === "EPERM" || code === "EBUSY") {
        if (attempt === maxAttempts) throw error;
        await sleep(150 * attempt);
        continue;
      }
      throw error;
    }
  }
}

async function main(): Promise<void> {
  await mkdir("./bin", { recursive: true });
  for (const candidate of CANDIDATE_OUTPUTS) {
    await removeWithRetry(candidate);
  }

  const build = Bun.spawn(["bun", "build", "./src/cli.ts", "--compile", "--outfile", OUTPUT_BASENAME], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit"
  });
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

await main();
