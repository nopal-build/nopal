/**
 * The Interacting-mode contract `OxEditor` hands down to `OxRenderer`'s tree
 * walk. When absent, `OxRenderer` renders exactly as it did in step 1 (pure
 * static output) — nothing here changes that path. When present, task
 * checkboxes and directives render as real interactables instead of plain
 * markup. See the `oxmarkdown` skill's "Interactables" section for the
 * interaction rules this implements (select-then-act, Tab/Shift+Tab focus
 * movement, checkbox Space/Tab activation, directive attribute popovers).
 *
 * Node references are only stable within ONE parsed tree. `OxEditor`
 * intentionally clears selection after any mutation, because a mutation
 * produces new markdown text, which gets re-parsed into an entirely new
 * tree with new node objects — the old selected reference wouldn't match
 * anything in it. See `components/OxEditor.tsx`.
 */

import type { DirectiveNode } from "./document";

export interface OxInteractive {
  isSelected: (node: object) => boolean;
  select: (node: object | null) => void;
  /** Mutates the given task-list-item node's `checked` state in place, then
   * re-serializes the whole document and reports the new markdown text. */
  toggleTask: (node: { checked?: boolean | null }) => void;
  /** Commits an attribute edit on a directive node (from its popover), then
   * re-serializes and reports the new markdown text. */
  editDirectiveAttr: (node: DirectiveNode, key: string, value: string) => void;
}
