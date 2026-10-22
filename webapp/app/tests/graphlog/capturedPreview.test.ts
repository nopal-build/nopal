import { describe, expect, it } from "vitest";
import { capturedPreview } from "robustness-core/data/syncGraph.server";

describe("capturedPreview", () => {
  it("never keeps half of an emoji at the cut", () => {
    const text = `${"a".repeat(159)}😵‍💫 and more`;
    const preview = capturedPreview(text);
    // A lone high surrogate at the end is what the API refused.
    expect(/[\uD800-\uDBFF]$/.test(preview)).toBe(false);
    expect(Array.from(preview)).toHaveLength(160);
  });

  it("collapses whitespace before cutting", () => {
    expect(capturedPreview("  one\n\n two  ")).toBe("one two");
  });
});
