/**
 * Small tree utilities over an `OxDocument` — framework-agnostic, same
 * rules as `document.ts`.
 */

import { visit } from "unist-util-visit";
import type { OxDocument } from "./document";
import { directiveAttrs, isDirectiveNode } from "./document";

export { visit };

/**
 * Every `file="..."`/`folder="..."` attribute value referenced by a
 * directive anywhere in the tree (any depth — this is what a real AST buys
 * us over the old regex scan, which only ever looked at leaf directives one
 * paragraph at a time). Used server-side to know what to resolve, without
 * rendering anything — see `data/project.server.ts`.
 */
export function findReferencedPaths(doc: OxDocument): {
  files: string[];
  folders: string[];
} {
  const files = new Set<string>();
  const folders = new Set<string>();

  visit(doc, (node) => {
    if (!isDirectiveNode(node)) return;
    const attrs = directiveAttrs(node);
    if (attrs.file) files.add(attrs.file);
    if (attrs.folder) folders.add(attrs.folder);
  });

  return { files: [...files], folders: [...folders] };
}
