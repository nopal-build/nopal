/**
 * `@` mentions — the replacement for the old `[[wiki-link]]` syntax (see the
 * oxmarkdown skill's "What's new and NOT yet implemented" section).
 *
 * Deliberately NOT a directive, and NOT a custom decorator node — typing
 * `@query` and selecting a result inserts an ordinary markdown link:
 *
 *   [@Casa Verde Remodel](/abc123:projects/Casa Verde Remodel)
 *
 * `@Name` is the link's own text (real, editable, plain text — a mention is
 * just a link once inserted, not a special opaque chip); the path is
 * whatever `MentionSearch` hands back, entirely opaque to the editor. This
 * needs zero new parsing or rendering work — `[text](url)` is already
 * core CommonMark, already round-trips through `editingTransforms.ts`'s
 * existing `LinkNode` handling, and already renders via `OxRenderer`'s
 * existing `case "link"`.
 *
 * `MentionSearch` is supplied by whoever embeds `OxEditor` — the editor
 * itself has no idea what a "vault" or a "human" is, only that typing `@`
 * plus some text should call this function and show whatever it returns.
 * That also means "create a new page when nothing matches" is NOT a
 * feature the editor needs to know about at all — an implementation is
 * free to include a synthetic "create" result in what it returns (and
 * actually perform the creation whenever that result is selected, however
 * it likes), entirely on its own side of this boundary.
 *
 * `onSelect` (a separate, optional prop on `OxEditor`/`MentionPlugin`) is
 * how an implementation finds out a selection actually happened, since
 * `search` alone only ever answers "what should the list show" — it's
 * used for two real things a mention search MAY want to do: record what
 * was picked (so a later empty search can surface "recently mentioned"),
 * and actually create whatever a synthetic `isNew` result promised.
 */

export interface MentionItem {
  /** The folder or file's own name — used as both the search-result row's
   * only visible text and the inserted link's text (`@${name}`). */
  name: string;
  /** The inserted link's URL. Entirely opaque to the editor — whatever
   * `search` returns here is written verbatim into the markdown. */
  path: string;
  /** Set by an implementation on a synthetic "create new" result — purely
   * a hint for whoever handles `onSelect` (e.g. "actually create a vault
   * file backing this path"); the mention plugin itself never reads this
   * field or treats a "create" result specially in any way. */
  isNew?: boolean;
}

export type MentionSearch = (
  query: string,
) => MentionItem[] | Promise<MentionItem[]>;
