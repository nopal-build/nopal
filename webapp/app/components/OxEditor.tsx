/**
 * OxEditor — the Interacting-mode (and, eventually, Editing-mode) surface
 * for an OxMarkdown document.
 *
 * One component covering both modes via `mode`, per the `oxmarkdown`
 * skill's "Naming" section — replacing the old three separate
 * MdxEditorClient/Workable/Editable components with one. Only
 * `mode="interacting"` is implemented so far (this is build-plan step 2);
 * `mode="editing"` needs a typing/caret surface, which is step 4, gated
 * behind the Lexical-vs-custom foundation decision (TODO 1). Accepted now
 * for forward API compatibility so call sites don't need to change again
 * when step 4 lands.
 *
 * Owns exactly two pieces of state: which interactable is selected, and the
 * parsed document those interactables mutate. Mutating and re-serializing
 * happens against the SAME parsed tree a render produced — not a fresh
 * re-parse — which is why this renders via `OxTreeRenderer` directly rather
 * than through `OxRenderer` (which parses its own private, unreachable
 * copy). See `oxmarkdown/interactive.ts` for why selection intentionally
 * clears after every mutation.
 */

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  parseOxDocument,
  serializeOxDocument,
  type DirectiveNode,
} from "../oxmarkdown/document";
import type { OxInteractive } from "../oxmarkdown/interactive";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";
import { themeToStyle, type OxTheme } from "../oxmarkdown/theme";
import { OxTreeRenderer } from "./OxRenderer";
import "../styles/oxmarkdown.css";

export interface OxEditorProps {
  markdown: string;
  onChange: (markdown: string) => void;
  /** See this file's header comment — only "interacting" actually does
   * anything today. */
  mode: "interacting" | "editing";
  directives?: DirectiveRegistry;
  theme?: OxTheme;
  className?: string;
}

export default function OxEditor({
  markdown,
  onChange,
  mode,
  directives,
  theme,
  className,
}: OxEditorProps) {
  const doc = useMemo(() => parseOxDocument(markdown), [markdown]);
  const [selected, setSelected] = useState<object | null>(null);
  const style = theme ? (themeToStyle(theme) as CSSProperties) : undefined;

  if (mode === "editing" && process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(
      '[OxEditor] mode="editing" isn\'t implemented yet (oxmarkdown skill, ' +
        'build plan step 4) — behaving as "interacting".',
    );
  }

  /** Every mutation follows the same shape: change the tree this render
   * already parsed, serialize THAT tree (not a fresh parse), hand the new
   * text to the caller, and clear selection — the next render will parse
   * the caller's updated markdown into an entirely new tree, so the old
   * selected reference can't mean anything there. */
  function commit() {
    onChange(serializeOxDocument(doc));
    setSelected(null);
  }

  const interactive: OxInteractive = {
    isSelected: (node) => node === selected,
    select: setSelected,
    toggleTask(node) {
      node.checked = !node.checked;
      commit();
    },
    editDirectiveAttr(node: DirectiveNode, key, value) {
      node.attributes = { ...node.attributes, [key]: value };
      commit();
    },
  };

  return (
    <div className={`ox-content ox-tokens${className ? ` ${className}` : ""}`} style={style}>
      <OxTreeRenderer doc={doc} directives={directives} interactive={interactive} />
    </div>
  );
}
