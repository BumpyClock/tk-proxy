const DURATION_FACTORS_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000
};

export function parseDurationMs(value: string): number {
  const normalized = String(value).trim().toLowerCase();
  const match = normalized.match(/^([0-9]+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value} (expected format like 30m, 5h, 1d)`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Duration must be greater than zero: ${value}`);
  }
  return amount * DURATION_FACTORS_MS[unit];
}

export function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function shouldRunDailySubmit(now: Date, lastSubmittedDate: string | null, submitHourUtc: number): boolean {
  if (!Number.isInteger(submitHourUtc) || submitHourUtc < 0 || submitHourUtc > 23) {
    throw new Error(`submitHourUtc must be an integer between 0 and 23: ${submitHourUtc}`);
  }
  if (now.getUTCHours() < submitHourUtc) {
    return false;
  }
  const today = utcDateString(now);
  return lastSubmittedDate !== today;
}

export function computeWaitWithJitterMs(baseMs: number, jitterMs: number, random: () => number = Math.random): number {
  if (baseMs <= 0) throw new Error(`baseMs must be greater than zero: ${baseMs}`);
  if (jitterMs < 0) throw new Error(`jitterMs must be zero or positive: ${jitterMs}`);
  if (jitterMs === 0) return baseMs;
  return baseMs + Math.floor(random() * jitterMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
