/**
 * The one place the renderer turns a vault file's URL into a browser-sized
 * one. The markdown (and every node the graph wrote) keeps pointing at
 * `/api/vault/view/<id>`: nodes are permanent, and the pen keys a photo's
 * unit off that URL. Only what the `<img>` loads changes.
 */

export type MediaRenditionSize = "thumb" | "display" | "poster";

const VIEW_URL = /^\/api\/vault\/view\/([A-Za-z0-9]+)(?:[?#].*)?$/;

/** `/api/vault/view/<id>` becomes `/api/vault/rendition/<id>?size=<size>`.
 * Any other URL (an external image, a public-view link) is returned as
 * it is: there is no rendition to ask for. */
export function renditionUrl(url: string, size: MediaRenditionSize): string {
  const m = VIEW_URL.exec(url);
  if (!m) return url;
  return `/api/vault/rendition/${m[1]}?size=${size}`;
}
