/**
 * The letter editor's picture picker (2026-10-21): the project's own
 * photos first, upload second; a pick is a standard markdown image on the
 * project's copy, captioned by the log.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPhotoPicker, pictureMarkdown } from "../components/ProjectPhotoPicker";

const photos = [
  { id: "c1", name: "IMG_1.jpeg", caption: "northwest corner", date: "2026-10-20", thumb: "/api/vault/rendition/c1?size=thumb", display: "/api/vault/rendition/c1?size=display" },
  { id: "c2", name: "IMG_2.jpeg", caption: "", date: "2026-10-19", thumb: "/api/vault/rendition/c2?size=thumb", display: "/api/vault/rendition/c2?size=display" },
];

describe("pictureMarkdown", () => {
  it("is a standard image on the project's copy, with the log's caption as the alt text, else the name", () => {
    expect(pictureMarkdown(photos[0])).toBe("![northwest corner](/api/vault/view/c1)");
    expect(pictureMarkdown(photos[1])).toBe("![IMG_2](/api/vault/view/c2)");
    expect(pictureMarkdown({ id: "x", name: "a.png", caption: "the [east] wall" })).toBe("![the east wall](/api/vault/view/x)");
  });
});

describe("the picker", () => {
  const noop = () => {};
  it("shows the project's photos as a grid with their captions, and the upload and close buttons", () => {
    const html = renderToStaticMarkup(<ProjectPhotoPicker photos={photos} loading={false} error={null} onPick={noop} onUpload={noop} onClose={noop} />);
    expect(html).toContain('data-photo="c1"');
    expect(html).toContain("northwest corner");
    expect(html).toContain("IMG_2.jpeg");
    expect(html).toContain("Upload from your computer");
    expect(html).toContain("Close");
  });

  it("says so while loading, when empty, and when the fetch failed", () => {
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={true} error={null} onPick={noop} onUpload={noop} onClose={noop} />)).toContain("Looking through");
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={false} error={null} onPick={noop} onUpload={noop} onClose={noop} />)).toContain("No photos on this project yet");
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={false} error="Project not found" onPick={noop} onUpload={noop} onClose={noop} />)).toContain("Project not found");
  });
});
