import { describe, expect, it } from "vitest";
import { letterLengthLabel, letterWordCount } from "../components/letterLength";
import { recordingBlock } from "../components/letterRecording";

describe("letter length", () => {
  it("counts the words a client reads, not the Markdown around them", () => {
    const body = [
      recordingBlock("abc123"),
      "",
      "# Hello **Maria**",
      "",
      "![a photo](/api/vault/view/xyz)",
      "",
      "Here's the [plan](https://example.com/plan) for next week.",
      "",
      "1. Seal, then test.",
      "- Baffles",
      "",
      ":::gallery",
      "![one](/a) ![two](/b)",
      ":::",
    ].join("\n");
    expect(letterWordCount(body)).toBe(12);
  });

  it("rounds the read time up and drops it for an empty letter", () => {
    expect(letterLengthLabel("")).toBe("0 words");
    expect(letterLengthLabel("One")).toBe("1 word · 1 min read");
    expect(letterLengthLabel(Array(231).fill("word").join(" "))).toBe("231 words · 2 min read");
  });
});
