import { describe, expect, it } from "vitest";
import { renditionUrl } from "../oxmarkdown/mediaUrls";

describe("renditionUrl", () => {
  it("rewrites a vault view URL to its rendition", () => {
    expect(renditionUrl("/api/vault/view/ntfc5km0612jeex7fjiv", "display")).toBe(
      "/api/vault/rendition/ntfc5km0612jeex7fjiv?size=display",
    );
    expect(renditionUrl("/api/vault/view/ntfc5km0612jeex7fjiv", "poster")).toBe(
      "/api/vault/rendition/ntfc5km0612jeex7fjiv?size=poster",
    );
  });

  it("drops a marker query the writer added, since the rendition route ignores it anyway", () => {
    expect(renditionUrl("/api/vault/view/abc123?type=video", "poster")).toBe("/api/vault/rendition/abc123?size=poster");
  });

  it("leaves any other URL alone", () => {
    expect(renditionUrl("https://example.com/a.png", "thumb")).toBe("https://example.com/a.png");
    expect(renditionUrl("/api/vault/public-view/abc123", "thumb")).toBe("/api/vault/public-view/abc123");
    expect(renditionUrl("/api/vault/view/", "thumb")).toBe("/api/vault/view/");
  });
});
