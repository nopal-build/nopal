/**
 * The copy of a photo the model reads (2026-10-02): a phone JPEG over the
 * API's 5 MB limit was refused as "oversized image" and never described,
 * so it never reached the graph. It is scaled to the edge the model reads
 * at full detail; a small one goes through untouched.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { fitImageForVision, VISION_MAX_EDGE } from "robustness-core/data/attachmentFrames.server";

async function noiseJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7919 + (i >> 5) * 104729) & 255;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

describe("the photo the model reads", () => {
  it("a large phone photo is scaled to fit, under the size limit", async () => {
    const big = await noiseJpeg(4032, 3024);
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    const out = await fitImageForVision({ base64: big.toString("base64"), mediaType: "image/jpeg" });
    const bytes = Buffer.from(out.base64, "base64");
    const meta = await sharp(bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(VISION_MAX_EDGE);
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
    expect(out.mediaType).toBe("image/jpeg");
  }, 30_000);

  it("a small photo goes through as it was", async () => {
    const small = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#7a9" } }).png().toBuffer();
    const image = { base64: small.toString("base64"), mediaType: "image/png" };
    expect(await fitImageForVision(image)).toBe(image);
  });
});
