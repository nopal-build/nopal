/**
 * What a public page does to a body's file URLs.
 *
 * Markdown in the vault points its pictures at `/api/vault/view/<id>`,
 * which needs a session. A public page (the shared Efforts page,
 * `newspaperShare.server.ts`; a letter, `letters.server.ts`)
 * rewrites every one of those to its own file route, and serves under
 * that route exactly the ids the body names right now, nothing else.
 * Both pages use these two functions so there is one definition of
 * "a file URL in a body".
 *
 * A `::video{fileId="..."}` directive (`OxRenderer.tsx`'s
 * `VideoDirectiveStatic`) is a different shape: its view URL is built at
 * RENDER time from the directive's `fileId` attribute, never embedded as a
 * literal `/api/vault/view/<id>` substring the way a picture's is, so the
 * regex above can never see it. `videoFileIds` finds those by actually
 * parsing the body, the same AST-walk `sorter.server.ts`'s
 * `extractFileAttachments` already uses for `::file{...}`. A public page's
 * own file-id allow-list (`letterFileIds`, `sharedFileIds`) unions this in
 * so a `::video{fileId="..."}` id is permitted too — rendering it under a
 * public page's own route is `OxRenderer.tsx`'s job (`videoViewUrl`), not
 * this module's.
 */

import { directiveAttrs, parseOxDocument, type DirectiveNode } from "oxmarkdown-core";

const VIEW_URL = /\/api\/vault\/view\/([A-Za-z0-9]+)/g;

/** Every `/api/vault/view/<id>` in `text`, pointed at `toUrl(id)`. */
export function rewriteViewUrls(text: string, toUrl: (id: string) => string): string {
  return text.replace(VIEW_URL, (_, id: string) => toUrl(id));
}

/** The file ids `text` names by view URL. */
export function viewFileIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(VIEW_URL)) ids.add(m[1]);
  return ids;
}

type AnyNode = { type: string; children?: AnyNode[] };

function walkNodes(node: AnyNode, visitor: (node: AnyNode) => void): void {
  visitor(node);
  if (Array.isArray(node.children)) for (const child of node.children) walkNodes(child, visitor);
}

/** Every `::video{fileId="..."}` directive's fileId in `text` — see this
 * module's own header for why these can't be found by `viewFileIds`'s
 * regex. A `::video{url="..."}` (YouTube) names no vault file, so it's
 * never in the result. */
export function videoFileIds(text: string): Set<string> {
  const ids = new Set<string>();
  const doc = parseOxDocument(text);
  walkNodes(doc as unknown as AnyNode, (node) => {
    if (node.type !== "leafDirective") return;
    const directive = node as unknown as DirectiveNode;
    if (directive.name !== "video") return;
    const attrs = directiveAttrs(directive);
    if (attrs.fileId) ids.add(attrs.fileId);
  });
  return ids;
}
