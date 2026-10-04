/**
 * A PDF too big to send inline (2026-10-03): Sunny's 46 MB bill of lading
 * was skipped every night because the API's 32 MB limit is on the whole
 * request. Now it goes up through the Files API, is read by its id, and
 * the upload is deleted after, whatever the outcome. A small one is still
 * sent inline, on the plain endpoint.
 */
import { describe, expect, it } from "vitest";
import { AnthropicProvider, INLINE_DOCUMENT_MAX_BASE64, documentNeedsUpload } from "robustness-core/data/anthropicProvider.server";
import { PDF_MAX_BYTES } from "robustness-core/data/syncKnowledge.server";

function fakeClient(opts: { failMessage?: boolean } = {}) {
  const calls = { uploads: 0, deletes: [] as string[], plain: [] as unknown[], beta: [] as unknown[] };
  const reply = { content: [{ type: "text", text: "- a bill of lading" }], usage: { input_tokens: 10, output_tokens: 5 } };
  const client = {
    messages: { create: async (p: unknown) => (calls.plain.push(p), reply) },
    beta: {
      files: {
        upload: async () => (calls.uploads++, { id: `file_${calls.uploads}` }),
        delete: async (id: string) => (calls.deletes.push(id), {}),
      },
      messages: {
        create: async (p: unknown) => {
          calls.beta.push(p);
          if (opts.failMessage) throw new Error("boom");
          return reply;
        },
      },
    },
  };
  return { client, calls };
}

function provider(client: unknown) {
  const p = new AnthropicProvider({ apiKey: "test", model: "claude-haiku-4-5" });
  (p as unknown as { client: unknown }).client = client;
  return p;
}

const pdf = (base64Length: number) => ({ base64: "A".repeat(base64Length), mediaType: "application/pdf" as const, label: "The PDF:" });
const input = (length: number) => ({ images: [], documents: [pdf(length)], context: "", framing: "Read it." });

describe("a PDF too big to send inline", () => {
  it("the line sits under the 32 MB request limit, and the ceiling is the worker's", () => {
    expect(documentNeedsUpload(INLINE_DOCUMENT_MAX_BASE64)).toBe(false);
    expect(documentNeedsUpload(INLINE_DOCUMENT_MAX_BASE64 + 1)).toBe(true);
    expect(INLINE_DOCUMENT_MAX_BASE64).toBeLessThan(32 * 1024 * 1024);
    // 46 MB, base64 a third bigger: over the inline line, under the ceiling.
    expect(documentNeedsUpload(Math.ceil((46_001_812 * 4) / 3))).toBe(true);
    expect(46_001_812).toBeLessThan(PDF_MAX_BYTES);
  });

  it("a small PDF goes inline on the plain endpoint, nothing uploaded", async () => {
    const { client, calls } = fakeClient();
    await provider(client).describeImages(input(1000));
    expect(calls.uploads).toBe(0);
    expect(calls.plain).toHaveLength(1);
    expect(JSON.stringify(calls.plain[0])).toContain('"type":"base64"');
  });

  it("a large one is uploaded, read by its id, and deleted after", async () => {
    const { client, calls } = fakeClient();
    const result = await provider(client).describeImages(input(INLINE_DOCUMENT_MAX_BASE64 + 4));
    expect(result.description).toBe("- a bill of lading");
    expect(calls.uploads).toBe(1);
    expect(calls.plain).toHaveLength(0);
    const sent = JSON.stringify(calls.beta[0]);
    expect(sent).toContain('"file_id":"file_1"');
    expect(sent).not.toContain('"type":"base64"');
    expect(calls.deletes).toEqual(["file_1"]);
  });

  it("the upload is deleted even when the read fails", async () => {
    const { client, calls } = fakeClient({ failMessage: true });
    await expect(provider(client).describeImages(input(INLINE_DOCUMENT_MAX_BASE64 + 4))).rejects.toThrow("boom");
    expect(calls.deletes).toEqual(["file_1"]);
  });
});
