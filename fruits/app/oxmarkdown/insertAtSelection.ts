/**
 * Puts `text` into `body` where the cursor is, as its own block: a blank
 * line before unless the cursor is at the start of the document or
 * already after one, and a blank line after unless one follows. Used by
 * the Vault's split editor when a picture lands in the text
 * (`vault.tsx`, `MarkdownSplitEditor`). Pure, so the test reads it.
 */
export function insertAtSelection(body: string, start: number, end: number, text: string): { body: string; cursor: number } {
  const before = body.slice(0, Math.max(0, Math.min(start, end)));
  const after = body.slice(Math.max(start, end));
  const lead = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = after.length === 0 ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${text}${tail}`;
  return { body: `${before}${inserted}${after}`, cursor: before.length + inserted.length };
}
