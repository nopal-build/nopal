/**
 * Media that loads (2026-09-22). A rendition is keyed by the source's
 * storage key, so the original and every synced copy share one; and the
 * extension table knows a phone's own formats, so a `.mov` is never
 * stored as octet-stream again.
 */
import { describe, expect, it } from "vitest";
import { isImageRenditionSize, renditionKey } from "robustness-core/data/mediaRenditions.server";
import { getFileContentType } from "robustness-core/data/file.server";

describe("renditions", () => {
  it("keys a rendition by the storage key, so an original and its synced copy share one", () => {
    const original = renditionKey("vault/admin_1/day/IMG_1.jpeg", "display");
    const copy = renditionKey("vault/admin_1/day/IMG_1.jpeg", "display");
    expect(copy).toBe(original);
    expect(original).toMatch(/^renditions\/[0-9a-f]{32}\/display\.webp$/);
  });

  it("gives each size its own object, and a poster its own format", () => {
    const key = "vault/admin_1/day/IMG_1615.mov";
    expect(renditionKey(key, "thumb")).not.toBe(renditionKey(key, "display"));
    expect(renditionKey(key, "poster")).toMatch(/\/poster\.jpg$/);
    expect(renditionKey(key, "thumb")).not.toBe(renditionKey("vault/admin_1/day/IMG_1616.mov", "thumb"));
  });

  it("accepts only the two image sizes", () => {
    expect(isImageRenditionSize("thumb")).toBe(true);
    expect(isImageRenditionSize("display")).toBe(true);
    expect(isImageRenditionSize("poster")).toBe(false);
    expect(isImageRenditionSize(null)).toBe(false);
  });
});

describe("content type by extension", () => {
  it("knows a phone's video and photo formats", () => {
    expect(getFileContentType("IMG_1615.mov")).toBe("video/quicktime");
    expect(getFileContentType("IMG_1615.MOV")).toBe("video/quicktime");
    expect(getFileContentType("clip.mp4")).toBe("video/mp4");
    expect(getFileContentType("IMG_0001.HEIC")).toBe("image/heic");
  });

  it("still falls back to octet-stream for what it does not know", () => {
    expect(getFileContentType("mystery.xyz")).toBe("application/octet-stream");
    expect(getFileContentType("photo.jpeg")).toBe("image/jpeg");
  });
});
