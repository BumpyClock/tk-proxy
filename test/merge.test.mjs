import test from "node:test";
import assert from "node:assert/strict";
import { combinePayloads } from "../src/merge.mjs";

function makePayload(contributions) {
  return {
    meta: {
      generatedAt: "2026-02-18T00:00:00.000Z",
      version: "0.1.0",
      dateRange: { start: contributions[0].date, end: contributions[contributions.length - 1].date }
    },
    summary: {
      totalTokens: 0,
      totalCost: 0,
      totalDays: contributions.length,
      activeDays: contributions.length,
      averagePerDay: 0,
      maxCostInSingleDay: 0,
      sources: [],
      models: []
    },
    years: [],
    contributions
  };
}

function sourceRow({ source, modelId, providerId, input = 0, output = 0, cost = 0, messages = 0 }) {
  return {
    source,
    modelId,
    providerId,
    tokens: {
      input,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0
    },
    cost,
    messages
  };
}

test("combinePayloads merges overlapping source rows on same date", () => {
  const payloadA = makePayload([
    {
      date: "2026-02-01",
      totals: { tokens: 0, cost: 0, messages: 0 },
      intensity: 0,
      tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      sources: [sourceRow({ source: "codex", modelId: "gpt-5.2-codex", providerId: "openai", input: 10, output: 2, cost: 1, messages: 3 })]
    }
  ]);

  const payloadB = makePayload([
    {
      date: "2026-02-01",
      totals: { tokens: 0, cost: 0, messages: 0 },
      intensity: 0,
      tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      sources: [
        sourceRow({ source: "codex", modelId: "gpt-5.2-codex", providerId: "openai", input: 5, output: 1, cost: 2, messages: 4 }),
        sourceRow({ source: "claude", modelId: "claude-opus", providerId: "anthropic", input: 7, output: 3, cost: 3, messages: 2 })
      ]
    }
  ]);

  const combined = combinePayloads([payloadA, payloadB]);
  assert.equal(combined.contributions.length, 1);
  assert.equal(combined.summary.totalTokens, 28);
  assert.equal(combined.summary.totalCost, 6);
  assert.equal(combined.summary.activeDays, 1);
  assert.deepEqual(combined.summary.sources, ["claude", "codex"]);
  assert.deepEqual(combined.summary.models, ["claude-opus", "gpt-5.2-codex"]);

  const day = combined.contributions[0];
  assert.equal(day.sources.length, 2);

  const codexRow = day.sources.find((row) => row.source === "codex");
  assert.ok(codexRow);
  assert.equal(codexRow.tokens.input, 15);
  assert.equal(codexRow.tokens.output, 3);
  assert.equal(codexRow.cost, 3);
  assert.equal(codexRow.messages, 7);
});

test("combinePayloads computes multi-day and multi-year summaries", () => {
  const payloadA = makePayload([
    {
      date: "2025-12-31",
      totals: { tokens: 0, cost: 0, messages: 0 },
      intensity: 0,
      tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      sources: [sourceRow({ source: "codex", modelId: "m1", providerId: "openai", input: 100, output: 0, cost: 2, messages: 1 })]
    }
  ]);
  const payloadB = makePayload([
    {
      date: "2026-01-01",
      totals: { tokens: 0, cost: 0, messages: 0 },
      intensity: 0,
      tokenBreakdown: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
      sources: [sourceRow({ source: "claude", modelId: "m2", providerId: "anthropic", input: 50, output: 50, cost: 4, messages: 2 })]
    }
  ]);

  const combined = combinePayloads([payloadA, payloadB]);
  assert.equal(combined.summary.totalTokens, 200);
  assert.equal(combined.summary.totalCost, 6);
  assert.equal(combined.summary.maxCostInSingleDay, 4);
  assert.equal(combined.meta.dateRange.start, "2025-12-31");
  assert.equal(combined.meta.dateRange.end, "2026-01-01");
  assert.equal(combined.years.length, 2);
  assert.equal(combined.years[0].year, "2025");
  assert.equal(combined.years[0].totalTokens, 100);
  assert.equal(combined.years[1].year, "2026");
  assert.equal(combined.years[1].totalTokens, 100);
});
