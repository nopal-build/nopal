/**
 * `::video{url="..."}` / `::video{fileId="..."}` — the "Video embed
 * directive" garden seed. STATIC/Interacting-mode rendering only (no
 * Editing-mode insertion UI), same category as `::file`/`::gallery`.
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

  it("extracts the id from a watch URL with other query params around it", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=30s")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  it("extracts the id from a youtu.be short link", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts the id from a youtu.be short link with a trailing query", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  });

  it("extracts the id from a Shorts link", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts the id from an already-embed URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for a non-YouTube URL", () => {
    expect(parseYouTubeId("https://vimeo.com/12345")).toBeNull();
  });

  it("returns null for a plain, non-URL string", () => {
    expect(parseYouTubeId("not a url")).toBeNull();
  });
});

describe("::video{...}", () => {
  it("renders a click-to-play YouTube facade for url=, not a bare iframe", () => {
    const html = render(`::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}`);
    expect(html).toContain("ox-video-facade");
    expect(html).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");
    expect(html).not.toContain("<iframe");
  });

  it("uses an explicit poster= override instead of YouTube's own thumbnail", () => {
    const html = render(
      `::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" poster="/api/vault/view/abc123"}`,
    );
    expect(html).toContain("/api/vault/view/abc123");
    expect(html).not.toContain("i.ytimg.com");
  });

  it("renders nothing for a url= that isn't a recognizable YouTube URL", () => {
    const html = render(`::video{url="https://example.com/clip.mp4"}`);
    expect(html).not.toContain("ox-video-directive");
  });

  it("renders a native <video> for fileId=", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4"}`);
    expect(html).toContain("<video");
    expect(html).toContain("/api/vault/view/abc123");
    expect(html).toContain("controls");
  });

  it("renders nothing when fileId='s own contentType isn't a video", () => {
    const html = render(`::video{fileId="abc123" contentType="image/png"}`);
    expect(html).not.toContain("ox-video-directive");
  });

  it("renders a fileId= video with no contentType attribute at all (trusts the author)", () => {
    const html = render(`::video{fileId="abc123"}`);
    expect(html).toContain("<video");
  });

  it("renders nothing when neither url= nor fileId= is given", () => {
    const html = render(`::video{}`);
    expect(html).not.toContain("ox-video-directive");
  });

  it("prefers url= over fileId= when both are given", () => {
    const html = render(
      `::video{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" fileId="abc123"}`,
    );
    expect(html).toContain("ox-video-facade");
    expect(html).not.toContain("<video");
  });

  it("defaults to a horizontal orientation", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4"}`);
    expect(html).toContain('data-orientation="horizontal"');
  });

  it("honors orientation=\"vertical\"", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4" orientation="vertical"}`);
    expect(html).toContain('data-orientation="vertical"');
  });

  it("renders an optional caption underneath, as real markdown", () => {
    const html = render(`::video{fileId="abc123" contentType="video/mp4" caption="A **bold** caption"}`);
    expect(html).toContain("ox-video-caption");
    expect(html).toContain("<strong>bold</strong>");
  });
});
