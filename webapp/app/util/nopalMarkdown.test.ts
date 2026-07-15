import { describe, it, expect } from "vitest";
import { parseNopalDocument, serializeDocument } from "./nopalMarkdown";

// ── File registry URL detection ─────────────────────────────────────────────
//
// Vault/daily-log files are now uploaded with a private S3 ACL (see
// file.server.ts), so anything embedded in a document points at the
// same-origin `/api/vault/view/:fileId` route instead of a raw S3 URL.
// parseNopalDocument must recognise both forms as "a real file reference",
// not just legacy absolute `http(s)://` URLs — otherwise every image/file
// embedded after that change would render as a permanently "uploading…"
// placeholder once the document is saved and reloaded.

describe("parseNopalDocument — file registry entries", () => {
  it("still recognises legacy absolute S3 URLs (backward compatibility)", () => {
    const raw =
      "Hello world" +
      "\n\n# Nopal Markdown\nFiles\n[1] https://bucket.example.com/vault/u1/root/123-photo.jpg";
    const { files } = parseNopalDocument(raw);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      index: 1,
      url: "https://bucket.example.com/vault/u1/root/123-photo.jpg",
      isImage: true,
    });
  });

  it("recognises the same-origin /api/vault/view/:fileId route as a real file", () => {
    const raw =
      "Hello world" +
      "\n\n# Nopal Markdown\nFiles\n[1] /api/vault/view/abc123?name=My%20Photo.jpg";
    const { files } = parseNopalDocument(raw);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      index: 1,
      url: "/api/vault/view/abc123?name=My%20Photo.jpg",
      isImage: true,
    });
  });

  it("treats a non-image vault view URL as a file, not an image", () => {
    const raw =
      "Hello world" +
      "\n\n# Nopal Markdown\nFiles\n[1] /api/vault/view/abc123?name=notes.pdf";
    const { files } = parseNopalDocument(raw);
    expect(files[0]).toMatchObject({ url: expect.any(String), isImage: false });
  });

  it("still treats a bare placeholder name as still-uploading (no url)", () => {
    const raw = "Hello world" + "\n\n# Nopal Markdown\nFiles\n[1] photo.jpg";
    const { files } = parseNopalDocument(raw);
    expect(files[0]).toMatchObject({ url: null, isImage: false });
  });

  it("round-trips through serializeDocument", () => {
    const files = [
      { index: 1, url: "/api/vault/view/abc123?name=photo.jpg", name: "photo.jpg" },
    ];
    const serialized = serializeDocument("Hello world", files);
    const { files: reparsed } = parseNopalDocument(serialized);
    expect(reparsed[0]).toMatchObject({
      url: "/api/vault/view/abc123?name=photo.jpg",
      isImage: true,
    });
  });
});
