/**
 * ProjectView — renders a project folder's README as a rolled-up project
 * page. The README's body IS the page (rendered via MdxEditorView, same as
 * any other vault markdown); the only project-specific work here is
 * supplying a `directives` registry so `::csv-table{...}`, `::gallery{...}`,
 * and `::svg{...}` in that body resolve to real content instead of showing
 * as "unknown directive" markers. See `app/data/project.types.ts` for the
 * manifest shape and `app/util/nopalDirectives.ts` for the directive syntax.
 *
 * Responsive strategy:
 *   - `layout: "document"` (default): no special className at all — this is
 *     just a plain markdown document, identical to any other vault README.
 *     Directive blocks render inline, full-width, in document order. Can't
 *     look broken on any viewport.
 *   - `layout: "grid"`: the outer content div becomes a 6-column CSS grid on
 *     `md`+ viewports (1 column below it). Prose elements (headings,
 *     paragraphs) default to full-width; a directive block can opt into
 *     `size="half"`/`"third"` via its attribute, which maps to a grid-span
 *     class on that block's own wrapper. Because grid auto-placement packs
 *     items in document order, this needs no coordinate math from AI or a
 *     human author — just a size hint per block, same as before.
 */

import type { ProjectManifest, ResolvedFile } from "../data/project.types";
import type { DirectiveRegistry } from "../util/nopalDirectives";
import MdxEditorView from "./MdxEditorView";

export interface ProjectViewProps {
  manifest: ProjectManifest;
  /** The README body (front matter already stripped). */
  body: string;
  /** Keyed by a directive's `file="..."` attribute value. */
  files: Record<string, ResolvedFile>;
  /** Keyed by a directive's `folder="..."` attribute value. */
  folders: Record<string, ResolvedFile[]>;
  /** Flat key/value facts from `project.csv`, if present — what
   * `:csv-key{key="..."}` resolves against. */
  csvFields?: Record<string, string>;
}

/** "full" needs no class — `.nopal-content--grid > *` already defaults every
 * block to full width (see mdxeditor.css); only half/third need to opt out. */
const SIZE_CLASS: Record<string, string | undefined> = {
  full: undefined,
  half: "nopal-block-half",
  third: "nopal-block-third",
};

function blockClassName(
  isGrid: boolean,
  size: string | undefined,
  fallback: "full" | "half" | "third",
): string | undefined {
  if (!isGrid) return undefined;
  return SIZE_CLASS[size ?? fallback] ?? SIZE_CLASS[fallback];
}

export function ProjectView({ manifest, body, files, folders, csvFields }: ProjectViewProps) {
  const isGrid = manifest.layout === "grid";

  const directives: DirectiveRegistry = {
    "csv-table": ({ attrs }) => (
      <div className={blockClassName(isGrid, attrs.size, "full")}>
        {attrs.title && <h2 className="font-bold text-lg mb-2">{attrs.title}</h2>}
        <CsvTable csv={files[attrs.file ?? ""]?.content ?? ""} />
      </div>
    ),
    gallery: ({ attrs }) => (
      <div className={blockClassName(isGrid, attrs.size, "half")}>
        {attrs.title && <h2 className="font-bold text-lg mb-2">{attrs.title}</h2>}
        <Gallery images={folders[attrs.folder ?? ""] ?? []} />
      </div>
    ),
    svg: ({ attrs }) => {
      const file = files[attrs.file ?? ""];
      if (!file) return null;
      return (
        <div className={blockClassName(isGrid, attrs.size, "half")}>
          {attrs.title && <h2 className="font-bold text-lg mb-2">{attrs.title}</h2>}
          <img src={file.url} alt={attrs.title ?? file.name} className="w-full rounded" />
        </div>
      );
    },
    // A container directive example (`:::note{...} ... :::`) — wraps nested
    // markdown rather than pointing at a file/folder. Not required by any
    // block above; included so the container form has a real, styled
    // renderer instead of only the generic "show the content, drop the
    // wrapper" fallback MdxRenderer uses for unregistered container names.
    note: ({ attrs, children }) => (
      <div
        className={blockClassName(isGrid, attrs.size, "full")}
        style={{ borderLeft: "3px solid var(--purple-light)", paddingLeft: "12px" }}
      >
        {attrs.title && <div className="font-bold text-sm mb-1">{attrs.title}</div>}
        {children}
      </div>
    ),
  };

  return (
    <MdxEditorView
      markdown={body}
      directives={directives}
      csvFields={csvFields}
      className={isGrid ? "nopal-content--grid" : undefined}
    />
  );
}

// ── csv-table ────────────────────────────────────────────────────────────

/** Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes,
 * and commas/newlines inside quotes. Good enough for AI/human-authored
 * budget-style CSVs; not a full spec implementation. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function CsvTable({ csv }: { csv: string }) {
  const rows = parseCsv(csv);
  if (rows.length === 0) return null;
  const [header, ...body] = rows;

  return (
    <div className="good-box overflow-x-auto p-0">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} className="text-left p-2 font-bold" style={{ borderBottom: "1px solid var(--border-color, currentColor)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="p-2" style={{ borderBottom: "1px solid var(--border-color, currentColor)", opacity: j === 0 ? 1 : 0.85 }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── gallery ──────────────────────────────────────────────────────────────

function Gallery({ images }: { images: ResolvedFile[] }) {
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {images.map((img) => (
        <img key={img.url} src={img.url} alt={img.name} className="w-full aspect-square object-cover rounded" />
      ))}
    </div>
  );
}
