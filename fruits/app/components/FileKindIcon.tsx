/**
 * Graphical per-kind icons for a non-picture `::file{...}` attachment's
 * tile (`OxRenderer.tsx`'s `FileDirectiveLayout`) — real glyphs from
 * Tabler Icons (MIT license, https://tabler.io/icons), their SVG paths
 * copied directly rather than pulling in the whole icon package for a
 * handful of static shapes. `currentColor` throughout, same convention
 * as every other icon in this app (`RemoveFileIcon`, `PlayGlyph`, ...).
 */
import type { ComponentType, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps): IconProps {
  return {
    width: 32,
    height: 32,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...props,
  };
}

/** Tabler `file-type-pdf`. */
export function FileTypePdfIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
      <path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" />
      <path d="M17 18h2" />
      <path d="M20 15h-3v6" />
      <path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" />
    </svg>
  );
}

/** Tabler `file-type-doc`. */
export function FileTypeDocIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
      <path d="M5 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" />
      <path d="M20 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0" />
      <path d="M12.5 15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -3 0v-3a1.5 1.5 0 0 1 1.5 -1.5" />
    </svg>
  );
}

/** Tabler `file-type-docx`. */
export function FileTypeDocxIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
      <path d="M2 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" />
      <path d="M17 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0" />
      <path d="M9.5 15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -3 0v-3a1.5 1.5 0 0 1 1.5 -1.5" />
      <path d="M19.5 15l3 6" />
      <path d="M19.5 21l3 -6" />
    </svg>
  );
}

/** Tabler `file-type-txt`. */
export function FileTypeTxtIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M16.5 15h3" />
      <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
      <path d="M4.5 15h3" />
      <path d="M6 15v6" />
      <path d="M18 15v6" />
      <path d="M10 15l4 6" />
      <path d="M10 21l4 -6" />
    </svg>
  );
}

/** Tabler `file-type-zip`. */
export function FileTypeZipIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
      <path d="M16 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" />
      <path d="M12 15v6" />
      <path d="M5 15h3l-3 6h3" />
    </svg>
  );
}

/** Tabler `file-smile` — the generic fallback for anything that isn't
 * one of the kinds above (a spreadsheet, an archive format beyond zip,
 * anything unrecognized). Deliberately not trying to draw a bespoke
 * glyph for every possible extension. */
export function FileSmileIcon(props: IconProps = {}) {
  return (
    <svg {...base(props)}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2m-7 -7h.01m3.99 0h.01" />
      <path d="M10 17a3.5 3.5 0 0 0 4 0" />
    </svg>
  );
}

/** Picks the graphical icon for a non-picture `::file{...}` tile, by the
 * filename's extension first, falling back to content type — same
 * precedence `fileKindLabel` (`OxRenderer.tsx`) already uses, so the
 * icon and the accessible label it's given always agree. */
export function fileKindIcon(name: string, contentType?: string): ComponentType<IconProps> {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  if (ext === "pdf" || contentType === "application/pdf") return FileTypePdfIcon;
  if (ext === "docx") return FileTypeDocxIcon;
  if (ext === "doc") return FileTypeDocIcon;
  if (ext === "txt" || contentType === "text/plain") return FileTypeTxtIcon;
  if (ext === "zip" || contentType === "application/zip") return FileTypeZipIcon;
  return FileSmileIcon;
}
