/**
 * The letter editor's picture picker (2026-10-21): the project's own
 * photos first, upload second; a pick is a standard markdown image on the
 * project's copy, captioned by the log.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PHOTO_IN_LETTER, ProjectPhotoPicker, isPhotoInLetter, pictureMarkdown } from "../components/ProjectPhotoPicker";

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
  it("shows the project's photos as a grid with their captions, and the upload button; the sheet it sits on is the way back", () => {
    const html = renderToStaticMarkup(<ProjectPhotoPicker photos={photos} loading={false} error={null} onPick={noop} onUpload={noop} />);
    expect(html).toContain('data-photo="c1"');
    expect(html).toContain("northwest corner");
    expect(html).toContain("IMG_2.jpeg");
    expect(html).toContain("Upload from your computer");
    expect(html).not.toContain("Close");
    expect(html).not.toContain(PHOTO_IN_LETTER);
  });

  it("marks a photo the letter already holds, and only that one", () => {
    const body = "# Dear both\n\n![northwest corner](/api/vault/view/c1)\n";
    expect(isPhotoInLetter(body, "c1")).toBe(true);
    expect(isPhotoInLetter(body, "c")).toBe(false);
    const html = renderToStaticMarkup(<ProjectPhotoPicker photos={photos} loading={false} error={null} body={body} onPick={noop} onUpload={noop} />);
    expect(html).toMatch(/data-photo="c1" data-in-letter="true"/);
    expect(html).not.toMatch(/data-photo="c2" data-in-letter/);
    expect(html.split(PHOTO_IN_LETTER).length - 1).toBe(1);
  });

  it("says so while loading, when empty, and when the fetch failed", () => {
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={true} error={null} onPick={noop} onUpload={noop} />)).toContain("Looking through");
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={false} error={null} onPick={noop} onUpload={noop} />)).toContain("No photos on this project yet");
    expect(renderToStaticMarkup(<ProjectPhotoPicker photos={[]} loading={false} error="Project not found" onPick={noop} onUpload={noop} />)).toContain("Project not found");
  });
});
