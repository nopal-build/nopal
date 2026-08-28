/**
 * Shared types for the `::gallery{folder="..."}` interactable — a LEAF
 * directive (own row, no children) that renders every image inside a
 * named vault folder as a titled photo grid, resolved from OUTSIDE (see
 * `GalleryFolderResolver` below) — same "resolved externally" shape as
 * `::card{file="..."}`'s `CardResolver` (`cardDirective.ts`).
 *
 * Distinct from the CONTAINER `:::gallery{max-columns="N"} ![alt](url)
 * ... :::` directive (`document.ts`/`OxRenderer.tsx`'s
 * `collectGalleryImages`), which needs no resolver at all — its images
 * are ordinary inline markdown, already fully present in the document.
 * Both share the name "gallery" (mdast tells them apart by node TYPE —
 * `leafDirective` vs `containerDirective` — exactly like `::file{...}`
 * vs `:::toggle{...}` already differing only by shape) because they're
 * the same concept from an author's point of view: "show a group of
 * photos as a grid." Use the container form when photos are already
 * inline in the document being written by hand; use the leaf form to
 * reference an existing vault folder by name without re-listing every
 * photo — useful for anything that only ever knows file/folder NAMES,
 * never stable URLs it could embed inline.
 */

export interface ResolvedGalleryImage {
  url: string;
  name: string;
  /** Defaults to `"image"` when omitted, for any existing caller that
   * never had a reason to distinguish (every real image really is one) --
   * added once the gallery grid gained real video playback, so a caller
   * resolving a folder that also contains videos can say so. */
  kind?: "image" | "video";
}

/** A plain lookup function, same spirit as `CardResolver` — the renderer
 * has no concept of "vault" or "folder resolution"; it just calls this
 * with a `::gallery{folder="..."}` directive's `folder` attribute and
 * renders whatever comes back. Returns `null`/`undefined` for a folder
 * this particular render pass has no data for (unknown name, still
 * loading, etc.) — the directive then renders nothing rather than an
 * empty box. An empty array (folder exists but has no images) also
 * renders nothing. */
export type GalleryFolderResolver = (folderName: string) => ResolvedGalleryImage[] | null | undefined;
