/**
 * PORTED from fruits/app/tests/videoDirective.test.tsx — see that file's
 * header. `::video{url="..."}` / `::video{fileId="..."}` on this trimmed,
 * read-only `/v2` copy of `OxRenderer`.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseYouTubeId } from "oxmarkdown-core";
import OxRenderer from "../components/OxRenderer";

function render(markdown: string) {
  return renderToStaticMarkup(<OxRenderer markdown={markdown} />);
}

describe("parseYouTubeId", () => {
  it("extracts the id from an ordinary watch URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for a non-YouTube URL", () => {
    expect(parseYouTubeId("https://vimeo.com/12345")).toBeNull();
  });
});

describe("::video{...}", () => {
  it("renders a click-to-play YouTube facade for url=, not a bare iframe", () => {
    const html = render(`::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}`);
    expect(html).toContain("ox-video-facade");
    expect(html).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");
    expect(html).not.toContain("<iframe");
  });

  it("renders a native <video> for fileId=, using the plain vault view URL (no rendition helper here)", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4"}`);
    expect(html).toContain("<video");
    expect(html).toContain("/api/vault/view/abc123");
  });

  it("renders nothing when fileId='s own contentType isn't a video", () => {
    const html = render(`::video{fileId="abc123" contentType="image/png"}`);
    expect(html).not.toContain("ox-video-directive");
  });

  it("renders nothing when neither url= nor fileId= is given", () => {
    const html = render(`::video{}`);
    expect(html).not.toContain("ox-video-directive");
  });

  it("honors orientation=\"vertical\"", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4" orientation="vertical"}`);
    expect(html).toContain('data-orientation="vertical"');
  });

  it("renders an optional caption underneath", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4" caption="A **bold** caption"}`);
    expect(html).toContain("ox-video-caption");
    expect(html).toContain("<strong>bold</strong>");
  });
});
