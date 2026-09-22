/**
 * ADR-021: the web server never processes media (Austin, 2026-09-22). Renditions,
 * posters and frames are made in the worker and stored in S3; the app
 * checks for them and streams/redirects. This pins it: no route or
 * component in this app may call a decoder or a resizer. The former
 * exception, the public-folder thumbnail route, was moved onto the same
 * worker path (2026-09-22) and no longer needs an allow-list entry.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set<string>([]);
const FORBIDDEN = [
  /from "sharp"/,
  /from "heic-convert"/,
  /from "ffmpeg-static"/,
  /\bgetImageThumbnail\b/,
  /\bheicToJpeg\b/,
  /\bnormalizeImageForVision\b/,
  /\bvideoToStills\b/,
  /\bwriteImageRenditions\b/,
  /\bmakeRenditionsForFile\b/,
  // Imports of the decoding modules, not mentions of them in a comment.
  /from "robustness-core\/data\/mediaRenditions\.server"/,
  /from "robustness-core\/data\/attachmentFrames\.server"/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "tests" ? [] : files(full);
    return /\.(ts|tsx|js)$/.test(name) ? [full] : [];
  });
}

describe("the web server never processes media", () => {
  it("no file under fruits/app decodes or resizes an image or a video", () => {
    const offenders: string[] = [];
    for (const file of files(APP_DIR)) {
      const rel = path.relative(APP_DIR, file);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${rel}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });
});
