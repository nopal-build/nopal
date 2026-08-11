/**
 * Shared types + insertion logic for the `::card{file="..."}` interactable
 * — a Card's own markdown file lives SEPARATELY in the vault (alongside
 * that day's `readme.md`); this leaf directive is just the "mount point"
 * marking where it appears in the day's flow (own row, no children — the
 * same "mount point, not nested markdown" shape as `::file{...}`, avoiding
 * the known oxmarkdown limitation that a container directive's nested
 * content isn't independently editable yet — see the `oxmarkdown` skill's
 * Daily Log section and the `vault` skill).
 *
 * Unlike `::file{...}`, a Card's CONTENT never lives in an attribute on
 * this directive — it's resolved from OUTSIDE (see `CardResolver` below),
 * since it's a whole separate vault file with its own load/save lifecycle,
 * not a short caption round-tripping through this directive's own
 * `setAttribute`.
 */

import { parseOxDocument, serializeOxDocument, type DirectiveNode } from "./document";
import type { RootContent } from "mdast";

/** What `OxEditor`'s `resolveCard` prop resolves a `::card{file="..."}`
 * directive's `file` attribute to — everything its decorator needs to
 * render a real, editable Card: the project it belongs to (for the
 * header + "open project" link) and a controlled `markdown`/`onChange`
 * pair for the nested `<OxEditor>` (see `editingNodes.tsx`'s
 * `OxDirectiveDecorator`), exactly like any other controlled OxEditor
 * instance — `onChange` is expected to debounce its own save, the same
 * way `fruits_.daily-log.tsx`'s `TodayLogEntry` already does for the
 * day's own readme. */
export interface ResolvedCard {
  projectName: string;
  /** Where "open project →" should link to. */
  projectHref: string;
  markdown: string;
  onChange: (markdown: string) => void;
  /** True while this Card is an OPTIMISTIC placeholder — added to the UI
   * immediately on "Add a card" (before the server has actually created
   * the underlying vault file), so the round trip doesn't have to finish
   * before the row appears. `projectName`/`projectHref` are already the
   * REAL values (known client-side without asking the server — see
   * `cardFileName`/`isPendingCardFileId` below), so only the content area
   * needs to visually defer to the real thing landing: see
   * `CardDirectiveLayout`'s `pending` prop (`components/OxRenderer.tsx`)
   * and its Editing-mode counterpart in `editingNodes.tsx`. Never set by
   * `resolveCard` implementations directly — derived from whether the
   * underlying `DailyLogCard.fileId` is a placeholder id (see
   * `isPendingCardFileId`), so it can never drift from reality once the
   * real fileId lands. */
  pending?: boolean;
}

/** The deterministic filename `createDailyLogCard` (`data/dailyLog.server.ts`)
 * uses for a project's Card on a given day — shared here (an isomorphic
 * module, unlike the `.server.ts` file that owns the real creation logic)
 * so the CLIENT can compute the same filename up front, before the server
 * round trip even starts. This is what makes an optimistic "Add a card"
 * possible at all: without a shared, deterministic filename, the client
 * would have no `file="..."` value to put in the `::card{...}` directive
 * until the server handed one back. */
export function cardFileName(projectFolderId: string): string {
  return `card-${projectFolderId}.md`;
}

// The placeholder `fileId` an optimistically-added `DailyLogCard` gets
// before the server's real vault-file id is known — deliberately NOT a
// plausible-looking real id, so a bug that skips replacing it is obvious
// rather than silently saving content against a fake id.
const PENDING_FILE_ID_PREFIX = "pending:";

export function pendingCardFileId(fileName: string): string {
  return `${PENDING_FILE_ID_PREFIX}${fileName}`;
}

export function isPendingCardFileId(fileId: string): boolean {
  return fileId.startsWith(PENDING_FILE_ID_PREFIX);
}

/** A plain lookup function, same spirit as `oxmarkdown/mention.ts`'s
 * `MentionSearch` — `OxEditor` has no concept of "vault" or "project"; it
 * just calls this with a `::card{...}` directive's `file` attribute and
 * renders whatever comes back. Returns `null`/`undefined` for a file this
 * particular render pass doesn't have data for (e.g. still loading), in
 * which case the decorator renders a plain placeholder instead of a live
 * editor. */
export type CardResolver = (fileName: string) => ResolvedCard | null | undefined;

/**
 * Appends a `::card{file="..." projectFolderId="..."}` leaf directive to
 * the END of `markdown` and returns the new full markdown string — used
 * by "Add a card" (a Chip click, not a cursor-position insertion, since a
 * new Card is always a whole new section appended at the day's end; a
 * future `/card` slash command could trigger the identical action from
 * the cursor instead, without changing anything about how a Card renders
 * — see the `oxmarkdown` skill).
 *
 * Deliberately works at the plain mdast level (parse -> append ->
 * re-serialize) rather than through a live Lexical editor instance:
 * "Add a card" is triggered from OUTSIDE the editor (a Chip click), with
 * no live `LexicalEditor` reference at hand. The caller feeds the result
 * straight back in as the OxEditor's own controlled `markdown` prop,
 * which `MarkdownSyncPlugin` re-seeds from as an ordinary "changed from
 * outside" update — not an echo of the editor's own `onChange`.
 */
export function appendCardDirectiveMarkdown(
  markdown: string,
  attrs: { file: string; projectFolderId: string },
): string {
  const doc = parseOxDocument(markdown);
  const directive: DirectiveNode = {
    type: "leafDirective",
    name: "card",
    attributes: { file: attrs.file, projectFolderId: attrs.projectFolderId },
    children: [],
  };
  doc.children.push(directive as unknown as RootContent);
  return serializeOxDocument(doc);
}

/**
 * The symmetric rollback for `appendCardDirectiveMarkdown` — removes the
 * `::card{file="..."}` directive for `file` from `markdown`, if present.
 * Used when an OPTIMISTICALLY-added card's server-side creation actually
 * fails (e.g. a permission check rejects it) — the append already ran (and
 * was already saved) at click time, before the round trip even started,
 * so undoing it needs to be just as direct: parse, filter the one
 * directive out, re-serialize, exactly mirroring how the append itself
 * works. A no-op (returns `markdown` unchanged, just re-serialized) if no
 * matching directive is found — e.g. the user already removed the card
 * themselves while the request was still in flight. */
export function removeCardDirectiveMarkdown(markdown: string, file: string): string {
  const doc = parseOxDocument(markdown);
  doc.children = doc.children.filter(
    (node) =>
      !(
        (node as DirectiveNode).type === "leafDirective" &&
        (node as DirectiveNode).name === "card" &&
        (node as DirectiveNode).attributes?.file === file
      ),
  );
  return serializeOxDocument(doc);
}

/** Every project folder id already referenced by a `::card{...}` directive
 * in `markdown` — used to filter `AddCardSection`'s project chips down to
 * ones WITHOUT a card yet today (enforces one-card-per-project-per-day at
 * a glance; `createDailyLogCard` on the server enforces it for real, by
 * always reusing the same file rather than ever creating a duplicate). */
export function cardedProjectFolderIds(markdown: string): Set<string> {
  const doc = parseOxDocument(markdown);
  const ids = new Set<string>();
  for (const node of doc.children) {
    if (node.type !== "leafDirective" || (node as DirectiveNode).name !== "card") continue;
    const projectFolderId = (node as DirectiveNode).attributes?.projectFolderId;
    if (projectFolderId) ids.add(projectFolderId);
  }
  return ids;
}
