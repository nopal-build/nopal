/**
 * The one place the renderer turns a vault file's URL into a browser-sized
 * one. The markdown (and every node the graph wrote) keeps pointing at
 * `/api/vault/view/<id>`: nodes are permanent, and the pen keys a photo's
 * unit off that URL. Only what the `<img>` loads changes.
 */

export type MediaRenditionSize = "thumb" | "display" | "poster";

const VIEW_URL = /^\/api\/vault\/view\/([A-Za-z0-9]+)(?:[?#].*)?$/;
// The shared Efforts page's own copy of a view URL
// (`newspaperShare.server.ts`): the same file, served by the folder's link
// instead of a session, with its own rendition route beside it.
const SHARED_VIEW_URL = /^\/api\/newspaper\/([A-Za-z0-9]+)\/view\/([A-Za-z0-9]+)(?:[?#].*)?$/;
// A public letter's copy (`letters.server.ts`): the same file,
// served by the letter's own link, with its own rendition route.
const LETTER_VIEW_URL = /^\/api\/letter\/([A-Za-z0-9]+)\/view\/([A-Za-z0-9]+)(?:[?#].*)?$/;

/** `/api/vault/view/<id>` becomes `/api/vault/rendition/<id>?size=<size>`.
 * Any other URL (an external image, a public-view link) is returned as
 * it is: there is no rendition to ask for. */
export function renditionUrl(url: string, size: MediaRenditionSize): string {
  const m = VIEW_URL.exec(url);
  if (m) return `/api/vault/rendition/${m[1]}?size=${size}`;
  const shared = SHARED_VIEW_URL.exec(url);
  if (shared) return `/api/newspaper/${shared[1]}/rendition/${shared[2]}?size=${size}`;
  const letter = LETTER_VIEW_URL.exec(url);
  if (letter) return `/api/letter/${letter[1]}/rendition/${letter[2]}?size=${size}`;
  return url;
}

/** A video's poster, or nothing: an external video has no rendition, and
 * handing `<video poster>` the video's own URL makes the browser fetch
 * the whole clip as an image. */
export function posterUrl(url: string): string | undefined {
  return VIEW_URL.test(url) || SHARED_VIEW_URL.test(url) || LETTER_VIEW_URL.test(url) ? renditionUrl(url, "poster") : undefined;
}
