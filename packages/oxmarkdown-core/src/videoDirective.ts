/**
 * Shared, pure helpers for the `::video{url="..."}` / `::video{fileId="..."}`
 * built-in leaf directive — see the "Video embed directive" garden seed.
 *
 * STATIC/Interacting-mode rendering only, same deliberate scope as Grid/
 * Gallery (`OxRenderer.tsx`'s own header comments on those) — there is no
 * Editing-mode insertion UI at all. A video is always hand-written into the
 * markdown after it already exists (a self-hosted file uploaded via the
 * `nopal` CLI, or an existing YouTube link), the same way
 * `::gallery{folder="..."}` references an existing vault folder nobody
 * "inserted" through the UI either.
 *
 * `url` wins when both `url` and `fileId` are given; the directive renders
 * nothing (not an error marker) when neither is given, when `url` isn't a
 * recognized YouTube URL shape, or when a `fileId`'s own `contentType`
 * attribute is given and isn't a video — same "render nothing rather than
 * guess" convention every other built-in directive here already follows.
 */

export type VideoOrientation = "horizontal" | "vertical";

/** `horizontal` (a normal 16:9 ratio) is the only default — `vertical`
 * (9:16) is opt-in via `orientation="vertical"`. Anything else falls back
 * to horizontal rather than erroring. */
export function parseVideoOrientation(value: string | undefined): VideoOrientation {
  return value === "vertical" ? "vertical" : "horizontal";
}

/**
 * Extracts a YouTube video id from any URL shape a human is likely to
 * paste: the ordinary watch page, a shortened `youtu.be` link, a Shorts
 * link, or an already-`/embed/` URL. Returns `null` for anything else.
 *
 * Plain regex, deliberately not the global `URL` class — this package has
 * no DOM/Node lib in its `tsconfig.json` (it runs in both a browser and
 * the GraphLog worker), so `URL`'s TYPES aren't available here even though
 * the class itself exists at runtime in both environments.
 */
export function parseYouTubeId(url: string): string | null {
  const trimmed = url.trim();
  const hostAndRest = /^https?:\/\/(?:www\.|m\.|music\.)?(youtu\.be|youtube\.com)\/([^?#]*)(\?[^#]*)?/i.exec(trimmed);
  if (!hostAndRest) return null;
  const [, host, path, query = ""] = hostAndRest;
  if (host === "youtu.be") {
    const id = path.split("/")[0];
    return id || null;
  }
  const shorts = path.match(/^shorts\/([A-Za-z0-9_-]+)/);
  if (shorts) return shorts[1];
  const embed = path.match(/^embed\/([A-Za-z0-9_-]+)/);
  if (embed) return embed[1];
  if (path === "watch") {
    const v = query.match(/[?&]v=([A-Za-z0-9_-]+)/);
    if (v) return v[1];
  }
  return null;
}

/** The real embed src, on the `-nocookie` domain — Google's own
 * privacy-enhanced mode, so no cookie is set until a viewer actually
 * presses play. Only ever built once the facade below is clicked. */
export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`;
}

/** YouTube's own always-available thumbnail (no API key needed) — the
 * facade's default poster image before an explicit `poster="..."`
 * attribute overrides it. */
export function youTubeThumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
