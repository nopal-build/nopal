/**
 * Markdown-building for the `::file{...}` interactable — a leaf directive
 * mounting a real uploaded file (image, PDF, ...) inline, same built-in
 * tier as `:ref{...}`/`::card{...}` (see that file's own doc). Parsing
 * already lives generically in `robustness-core`'s `sorter.server.ts`
 * (`extractFileAttachments`, a bare `directiveAttrs` read — no dedicated
 * parser needed there).
 *
 * This BUILDER exists because GraphLog's `sync-graph` stage (see the
 * `graphlog` skill's "Files" section) is the first SERVER-side writer of
 * this directive — until now `::file{...}` was only ever authored by a
 * human, through the upload UI. A node whose source is an attachment
 * (a photo, a PDF, ...) gets this appended to its own text automatically,
 * by code, never typed out by the model — same "never trust the model
 * with markup it can get wrong" reasoning `:ref{...}`'s own citation
 * already follows.
 */

export type FileDirectiveAttrs = {
  fileId: string;
  name: string;
  caption?: string;
};

/** Same escaping `refDirective.ts`'s own (unexported) helper uses,
 * duplicated rather than shared — the two directives have no other reason
 * to depend on each other, and it's one line. See that file's own doc for
 * why a substitution (not a real escape) is the only option here. */
function escapeDirectiveAttrValue(value: string): string {
  return value.replace(/"/g, "\u201d");
}

export function buildFileDirectiveMarkdown(attrs: FileDirectiveAttrs): string {
  const parts = [
    `fileId="${escapeDirectiveAttrValue(attrs.fileId)}"`,
    `name="${escapeDirectiveAttrValue(attrs.name)}"`,
  ];
  if (attrs.caption) {
    parts.push(`caption="${escapeDirectiveAttrValue(attrs.caption)}"`);
  }
  return `::file{${parts.join(" ")}}`;
}
