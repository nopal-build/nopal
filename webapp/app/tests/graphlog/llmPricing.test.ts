/**
 * The price table behind every cost the dashboard and the grids print
 * (`llmPricing.ts`). Hand-kept from Anthropic's pricing page; these pin
 * the three models the pipeline runs on and the one place the 5.x models
 * differ from the rest: what a cached token costs to read.
 */
import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "robustness-core/data/llmPricing";

describe("cost per million tokens", () => {
  it("input and output, for the models a stage can run on", () => {
    expect(estimateCostUsd("claude-fable-5-1", 1_000_000, 1_000_000)).toBeCloseTo(60);
    expect(estimateCostUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(24);
    expect(estimateCostUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(12);
    expect(estimateCostUsd("claude-opus-5", 1_000_000, 1_000_000)).toBeCloseTo(30);
  });

  it("a cached read is a fortieth of input on Fable, a twentieth on Opus 5.5, a tenth elsewhere", () => {
    expect(estimateCostUsd("claude-fable-5-1", 0, 0, 1_000_000)).toBeCloseTo(0.25);
    expect(estimateCostUsd("claude-opus-5-5", 0, 0, 1_000_000)).toBeCloseTo(0.2);
    expect(estimateCostUsd("claude-sonnet-5", 0, 0, 1_000_000)).toBeCloseTo(0.2);
    expect(estimateCostUsd("claude-opus-5", 0, 0, 1_000_000)).toBeCloseTo(0.5);
  });

  it("a cache write is a quarter more than input; an unlisted model has no price", () => {
    expect(estimateCostUsd("claude-fable-5-1", 0, 0, 0, 1_000_000)).toBeCloseTo(12.5);
    expect(estimateCostUsd("claude-made-up", 1, 1)).toBeNull();
  });
});
