export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
}

export interface SourceContribution {
  source: string;
  modelId: string;
  providerId: string;
  tokens: TokenCounts;
  cost: number;
  messages: number;
}

export interface DailyContribution {
  date: string;
  totals: {
    tokens: number;
    cost: number;
    messages: number;
  };
  intensity: number;
  tokenBreakdown: TokenCounts;
  sources: SourceContribution[];
}

export interface YearSummary {
  year: string;
  totalTokens: number;
  totalCost: number;
  range: {
    start: string;
    end: string;
  };
}

export interface TokenContributionData {
  meta: {
    generatedAt: string;
    version: string;
    dateRange: {
      start: string;
      end: string;
    };
  };
  summary: {
    totalTokens: number;
    totalCost: number;
    totalDays: number;
    activeDays: number;
    averagePerDay: number;
    maxCostInSingleDay: number;
    sources: string[];
    models: string[];
  };
  years: YearSummary[];
  contributions: DailyContribution[];
}

const TOKEN_FIELDS: (keyof TokenCounts)[] = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];

function asNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeTokens(tokens: Partial<TokenCounts> = {}): TokenCounts {
  return {
    input: asNumber(tokens.input),
    output: asNumber(tokens.output),
    cacheRead: asNumber(tokens.cacheRead),
    cacheWrite: asNumber(tokens.cacheWrite),
    reasoning: asNumber(tokens.reasoning)
  };
}

function addTokens(target: TokenCounts, delta: Partial<TokenCounts>): void {
  for (const key of TOKEN_FIELDS) {
    target[key] += asNumber(delta[key]);
  }
}

function sumTokenValues(tokens: TokenCounts): number {
  return TOKEN_FIELDS.reduce((sum, key) => sum + asNumber(tokens[key]), 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isTokenContributionData(value: unknown): value is TokenContributionData {
  if (!isObject(value)) return false;
  if (!isObject(value.meta)) return false;
  if (!isObject(value.summary)) return false;
  if (!Array.isArray(value.contributions)) return false;
  return true;
}

export function extractPayloadFromJson(data: unknown): TokenContributionData | null {
  if (isTokenContributionData(data)) return data;
  if (isObject(data) && isTokenContributionData(data.submitPayload)) return data.submitPayload;
  if (isObject(data) && isTokenContributionData(data.parsedStdout)) return data.parsedStdout;
  return null;
}

function collectRows(payloads: TokenContributionData[]): Map<string, Map<string, SourceContribution>> {
  const byDate = new Map<string, Map<string, SourceContribution>>();
  for (const payload of payloads) {
    for (const day of payload.contributions ?? []) {
      const date = String(day.date ?? "");
      if (!date) continue;
      let dayMap = byDate.get(date);
      if (!dayMap) {
        dayMap = new Map<string, SourceContribution>();
        byDate.set(date, dayMap);
      }

      for (const sourceEntry of day.sources ?? []) {
        const source = String(sourceEntry.source ?? "unknown");
        const modelId = String(sourceEntry.modelId ?? "unknown");
        const providerId = String(sourceEntry.providerId ?? "unknown");
        const key = `${source}\u0001${modelId}\u0001${providerId}`;
        let row = dayMap.get(key);
        if (!row) {
          row = {
            source,
            modelId,
            providerId,
            tokens: normalizeTokens(),
            cost: 0,
            messages: 0
          };
          dayMap.set(key, row);
        }

        addTokens(row.tokens, normalizeTokens(sourceEntry.tokens));
        row.cost += asNumber(sourceEntry.cost);
        row.messages += asNumber(sourceEntry.messages);
      }
    }
  }
  return byDate;
}

function getIntensity(cost: number, maxCost: number): number {
  if (cost <= 0 || maxCost <= 0) return 0;
  const ratio = cost / maxCost;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function computeYearSummaries(contributions: DailyContribution[]): YearSummary[] {
  const years = new Map<string, YearSummary>();
  for (const day of contributions) {
    const year = day.date.slice(0, 4);
    let record = years.get(year);
    if (!record) {
      record = {
        year,
        totalTokens: 0,
        totalCost: 0,
        range: { start: day.date, end: day.date }
      };
      years.set(year, record);
    }
    record.totalTokens += day.totals.tokens;
    record.totalCost += day.totals.cost;
    if (day.date < record.range.start) record.range.start = day.date;
    if (day.date > record.range.end) record.range.end = day.date;
  }
  return [...years.values()].sort((a, b) => Number(a.year) - Number(b.year));
}

function buildContributions(byDate: Map<string, Map<string, SourceContribution>>): {
  contributions: DailyContribution[];
  maxCostInSingleDay: number;
} {
  const sortedDates = [...byDate.keys()].sort();
  const contributions: DailyContribution[] = [];
  let maxCostInSingleDay = 0;

  for (const date of sortedDates) {
    const rows = [...(byDate.get(date)?.values() ?? [])].sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.modelId !== b.modelId) return a.modelId.localeCompare(b.modelId);
      return a.providerId.localeCompare(b.providerId);
    });

    const tokenBreakdown = normalizeTokens();
    let dayCost = 0;
    let dayMessages = 0;
    for (const row of rows) {
      addTokens(tokenBreakdown, row.tokens);
      dayCost += row.cost;
      dayMessages += row.messages;
    }

    maxCostInSingleDay = Math.max(maxCostInSingleDay, dayCost);
    contributions.push({
      date,
      totals: {
        tokens: sumTokenValues(tokenBreakdown),
        cost: dayCost,
        messages: dayMessages
      },
      intensity: 0,
      tokenBreakdown,
      sources: rows.map((row) => ({
        source: row.source,
        modelId: row.modelId,
        providerId: row.providerId,
        tokens: row.tokens,
        cost: row.cost,
        messages: row.messages
      }))
    });
  }

  for (const day of contributions) {
    day.intensity = getIntensity(day.totals.cost, maxCostInSingleDay);
  }
  return { contributions, maxCostInSingleDay };
}

export function combinePayloads(payloads: TokenContributionData[]): TokenContributionData {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new Error("No payloads provided for combine.");
  }

  const byDate = collectRows(payloads);
  const { contributions, maxCostInSingleDay } = buildContributions(byDate);
  if (contributions.length === 0) {
    throw new Error("No contribution rows found in the provided payloads.");
  }

  const totalTokens = contributions.reduce((sum, item) => sum + item.totals.tokens, 0);
  const totalCost = contributions.reduce((sum, item) => sum + item.totals.cost, 0);
  const activeDays = contributions.length;
  const sourceSet = new Set<string>();
  const modelSet = new Set<string>();
  for (const day of contributions) {
    for (const source of day.sources) {
      sourceSet.add(source.source);
      modelSet.add(source.modelId);
    }
  }

  const dateRange = {
    start: contributions[0].date,
    end: contributions[contributions.length - 1].date
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: "tk-proxy-1.0.0",
      dateRange
    },
    summary: {
      totalTokens,
      totalCost,
      totalDays: activeDays,
      activeDays,
      averagePerDay: activeDays > 0 ? totalCost / activeDays : 0,
      maxCostInSingleDay,
      sources: [...sourceSet].sort(),
      models: [...modelSet].sort()
    },
    years: computeYearSummaries(contributions),
    contributions
  };
}
