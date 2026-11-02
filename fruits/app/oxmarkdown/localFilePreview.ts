// Ephemeral, client-only upload-UI state for a `::file{...}` directive
// node, keyed by its Lexical node key — a local preview image, and (further
// below) a live upload-progress fraction. Neither is ever a directive
// attribute: a `blob:`/`data:` URL or a number changing many times a
// second has no business in the document's own saved markdown.
//
// A just-picked file's OWN bytes are sitting right here in the browser —
// no reason to show a blank box until the server/worker round-trip
// produces a real rendition. `captureLocalFilePreview` makes an instant,
// client-only preview (a photo's own object URL; a video's own first
// frame, captured to a still image so it looks like the eventual real
// poster rather than a live clip) the moment a file is picked, keyed by
// the Lexical node key `fileDirective.ts`'s `uploadAndAttach` already has
// in scope. `OxRenderer.tsx`'s `FileDirectiveLayout` shows this while
// waiting, and preloads the REAL rendition in the background, only
// swapping once it's actually loaded (`releaseLocalFilePreview`) — so the
// box never flashes blank, and never flashes to a half-loaded network
// image either.
//
// Deliberately NOT stored as a directive attribute: a `blob:`/`data:` URL
// is only ever valid in THIS browser tab, for THIS session — writing one
// into the document's own markdown would persist garbage no reload or
// other collaborator could ever use. This is a plain module-level store
// (survives for the life of the page, not the editor instance), read via
// `useSyncExternalStore` so a component re-renders when an entry it
// doesn't have yet (the video capture is async) arrives.

import { useSyncExternalStore } from "react";

const previews = new Map<string, string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(nodeKey: string): string | undefined {
  return previews.get(nodeKey);
}

/** Releases a preview's `blob:`/`data:` URL and forgets it — call once the
 * real rendition has loaded, or the file directive is removed. Safe to
 * call for a key with no preview (e.g. a PDF, or a different tab). */
export function releaseLocalFilePreview(nodeKey: string): void {
  if (!previews.has(nodeKey)) return;
  previews.delete(nodeKey);
  notify();
}

/** Captures `nodeKey`'s instant local preview from `file`. Images: their
 * own object URL, immediately. Videos: decode the first frame onto an
 * offscreen canvas and store THAT as a still `data:` URL — a live
 * `<video>` of the raw pick would look inconsistent with the real poster
 * it's standing in for, and some browsers won't reliably paint a decoded
 * frame without an explicit seek. Anything else (a PDF, ...) gets no
 * preview at all — nothing quick to draw, and the kind-label tile is
 * already correct the instant it's picked. Never throws: a capture
 * failure just means no preview, the same as before this existed. */
export function captureLocalFilePreview(nodeKey: string, file: File): void {
  if (file.type.startsWith("image/")) {
    previews.set(nodeKey, URL.createObjectURL(file));
    notify();
    return;
  }
  if (!file.type.startsWith("video/")) return;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";

  const cleanup = () => URL.revokeObjectURL(objectUrl);
  const capture = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        previews.set(nodeKey, canvas.toDataURL("image/jpeg", 0.7));
        notify();
      }
    } catch {
      // Decode/canvas failure (e.g. a format this browser can't decode
      // at all) — no local preview, falls back to the existing
      // upload-in-flight treatment. Not a crash.
    } finally {
      cleanup();
    }
  };

  video.addEventListener(
    "loadeddata",
    () => {
      // `loadeddata` alone isn't reliably a DECODED, drawable frame in
      // every browser (Safari in particular) — an explicit tiny seek and
      // waiting for `seeked` guarantees one before `drawImage`.
      video.addEventListener("seeked", capture, { once: true });
      try {
        video.currentTime = Math.min(0.1, video.duration || 0.1);
      } catch {
        capture();
      }
    },
    { once: true },
  );
  video.addEventListener("error", cleanup, { once: true });
  video.src = objectUrl;
}

/** Subscribes to `nodeKey`'s local preview, re-rendering the caller once
 * one arrives (the video case is async) or is released. */
export function useLocalFilePreview(nodeKey: string): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(nodeKey),
    () => undefined,
  );
}

// ─── Upload progress (0 to 1) ──────────────────────────────────────────────
// Same shape, same reasoning as the preview store above (ephemeral,
// client-only, keyed by nodeKey, read via `useSyncExternalStore`) — NOT a
// directive attribute, since writing a number that changes many times a
// second into the document's own markdown would mark it dirty and spam
// the Daily Log's autosave for no real reason (it's pure upload-UI
// chrome, meaningless once the upload settles either way).

const progress = new Map<string, number>();

/** Called from `fileDirective.ts`'s `uploadAndAttach` as `onUploadFile`'s
 * own progress callback — see `UploadFileFn`'s doc comment for how
 * reliably (or not) a given upload path actually calls this. */
export function setUploadProgress(nodeKey: string, fraction: number): void {
  progress.set(nodeKey, fraction);
  notify();
}

/** Call once an upload settles (success or failure) — a stale fraction
 * left behind would otherwise show 100% (or whatever it last was) on the
 * NEXT upload into a reused node key. Safe to call for a key with no
 * recorded progress. */
export function clearUploadProgress(nodeKey: string): void {
  if (!progress.has(nodeKey)) return;
  progress.delete(nodeKey);
  notify();
}

/** Subscribes to `nodeKey`'s upload progress, 0 to 1 — undefined before
 * the first report, or once cleared. */
export function useUploadProgress(nodeKey: string): number | undefined {
  return useSyncExternalStore(
    subscribe,
    () => progress.get(nodeKey),
    () => undefined,
  );
}

// ─── Retained file, for Retry ──────────────────────────────────────────
// The raw `File` a node's upload was given, kept around ONLY so a failed
// upload can be retried with the exact same bytes without asking the
// person to re-pick it. Plain imperative get/set, not reactive (nothing
// renders this directly) — unlike the two stores above, never read until
// a Retry click actually happens.

const files = new Map<string, File>();

/** Called for EVERY upload attempt, any file type (not just image/video
 * — `captureLocalFilePreview`'s own preview is type-gated, this isn't),
 * so Retry works for a PDF too. */
export function storeLocalFile(nodeKey: string, file: File): void {
  files.set(nodeKey, file);
}

/** The file to re-upload on a Retry click — undefined if none was ever
 * stored, or a page reload since cleared it (nothing persists this). */
export function getLocalFile(nodeKey: string): File | undefined {
  return files.get(nodeKey);
}

/** Call once an upload succeeds (no longer needed) or the attachment is
 * removed. Deliberately NOT called on failure — that's exactly when
 * Retry needs it still sitting here. */
export function forgetLocalFile(nodeKey: string): void {
  files.delete(nodeKey);
}
