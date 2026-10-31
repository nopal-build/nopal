/**
 * An image's format is read from its bytes, not its name (2026-10-30):
 * four screenshots named `.PNG` were JPEGs, sent to the model as
 * `image/png`, and refused ("the image appears to be a image/jpeg").
 */
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageTypeFromBytes, normalizeImageForVision } from "robustness-core/data/attachmentFrames.server";

const blank = () => sharp({ create: { width: 32, height: 24, channels: 3, background: "#7a9" } });

describe("the format the model is told", () => {
  it("each format the model takes is known by its bytes", async () => {
    expect(imageTypeFromBytes(await blank().jpeg().toBuffer())).toBe("image/jpeg");
    expect(imageTypeFromBytes(await blank().png().toBuffer())).toBe("image/png");
    expect(imageTypeFromBytes(await blank().gif().toBuffer())).toBe("image/gif");
    expect(imageTypeFromBytes(await blank().webp().toBuffer())).toBe("image/webp");
    expect(imageTypeFromBytes(Buffer.from("not an image"))).toBeNull();
  });

  it("a JPEG named .PNG goes to the model as a JPEG, untouched", async () => {
    const jpeg = await blank().jpeg().toBuffer();
    expect(await normalizeImageForVision(jpeg, "image/png")).toEqual({ base64: jpeg.toString("base64"), mediaType: "image/jpeg" });
  });

  it("a PNG named .jpg goes as a PNG", async () => {
    const png = await blank().png().toBuffer();
    expect((await normalizeImageForVision(png, "image/jpeg")).mediaType).toBe("image/png");
  });

  it("a TIFF still becomes a JPEG", async () => {
    const tiff = await blank().tiff().toBuffer();
    const out = await normalizeImageForVision(tiff, "image/tiff");
    expect(out.mediaType).toBe("image/jpeg");
    expect(imageTypeFromBytes(Buffer.from(out.base64, "base64"))).toBe("image/jpeg");
  });
});
