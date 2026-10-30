/**
 * A photo exported as JPEG can keep its `.HEIC` name, and its type comes
 * from the name (2026-10-30): 81 of one project's iPhone photos were JPEG
 * bytes typed `image/heic`, the HEIC decoder refused every one, and none
 * were described or got renditions. Bytes that are not HEIF are read as
 * what they are.
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { heicToJpeg, normalizeImageForVision } from "robustness-core/data/attachmentFrames.server";

describe("a JPEG named .HEIC", () => {
  it("decodes to a JPEG instead of being refused", async () => {
    const jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#7a9" } }).jpeg().toBuffer();
    const meta = await sharp(await heicToJpeg(jpeg)).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([640, 480]);
  });

  it("reaches the model as a JPEG", async () => {
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#7a9" } }).jpeg().toBuffer();
    const out = await normalizeImageForVision(jpeg, "image/heic");
    expect(out.mediaType).toBe("image/jpeg");
    expect((await sharp(Buffer.from(out.base64, "base64")).metadata()).format).toBe("jpeg");
  });

  it("bytes that are no image at all still throw", async () => {
    await expect(heicToJpeg(Buffer.from("not a photo at all"))).rejects.toThrow();
  });
});
