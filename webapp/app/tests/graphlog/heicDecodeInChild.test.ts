/**
 * A HEIC is decoded in a process of its own (2026-10-30): the WebAssembly
 * decoder never gives its memory back, and in the worker's process a
 * GraphLog run on a project of iPhone photos climbed until the worker
 * died at the same photo on two runs. The child returns the memory when
 * it exits; a photo it can't decode fails as that photo, with a reason.
 *
 * `fixtures/tiny.heic` is a 64x48 HEVC HEIC made with `heif-enc` from a
 * gradient, not a customer photo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { heicToJpeg } from "robustness-core/data/attachmentFrames.server";

const tinyHeic = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tiny.heic"));

describe("a HEIC decoded in its own process", () => {
  it("comes back as a JPEG of the same size", async () => {
    const meta = await sharp(await heicToJpeg(tinyHeic)).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([64, 48]);
  }, 30_000);

  it("several asked at once all come back", async () => {
    const outs = await Promise.all([1, 2, 3].map(() => heicToJpeg(tinyHeic)));
    for (const out of outs) expect((await sharp(out).metadata()).format).toBe("jpeg");
  }, 60_000);

  it("a HEIF header over bytes that are no photo fails with the decoder's reason", async () => {
    const broken = Buffer.concat([tinyHeic.subarray(0, 32), Buffer.alloc(200, 7)]);
    await expect(heicToJpeg(broken)).rejects.toThrow(/\S/);
    // And the next photo still decodes: one failure doesn't jam the turn.
    expect((await sharp(await heicToJpeg(tinyHeic)).metadata()).format).toBe("jpeg");
  }, 30_000);
});
