/**
 * `@` mention typeahead — see `mention.ts` for the syntax/architecture
 * decision (a real markdown link, not a directive or a custom node).
 *
 * Built on `@lexical/react`'s own `LexicalTypeaheadMenuPlugin` +
 * `useBasicTypeaheadTriggerMatch` rather than hand-rolled (unlike
 * `SlashCommandPlugin.tsx`) — this is a much closer match for what's
 * actually needed here: `useBasicTypeaheadTriggerMatch("@", ...)` already
 * implements exactly the "`@` at the start of a word, not mid-word (so
 * `user@example.com` never fires this)" trigger rule by itself, and
 * `LexicalTypeaheadMenuPlugin` already implements arrow-key highlight
 * navigation, Enter/Tab-to-select, and Escape-to-dismiss — all real,
 * proven infrastructure instead of re-solving the same problems
 * `SlashCommandPlugin` solves by hand for a menu that never needed
 * multi-item keyboard navigation in the first place.
 *
 * Positioning is also handled by the library, and confirmed safe against
 * the exact scroll-clipping bug class documented on `.ox-popover` (a
 * popover has to be ejected from any scrolling ancestor entirely, not just
 * `position: fixed` from wherever it happens to sit) — read directly from
 * `LexicalTypeaheadMenuPlugin`'s own source: its anchor element is
 * appended straight to `document.body` by default (`useMenuAnchorRef`'s
 * `parent` parameter), the same "escape the container" fix `.ox-popover`
 * needed, just via `position: absolute` + scroll-offset math instead of
 * `position: fixed` + a manually computed rect. `.ox-mention-menu` (see
 * `oxmarkdown.css`) therefore deliberately does NOT reuse `.ox-popover`
 * directly — that class's OWN `position: fixed` would fight the anchor
 * div's already-correct positioning if nested inside it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $insertNodes, type TextNode } from "lexical";
import { $createLinkNode } from "@lexical/link";
import type { MentionItem, MentionSearch } from "oxmarkdown-core";

class MentionOption extends MenuOption {
  item: MentionItem;
  constructor(item: MentionItem) {
    super(item.path);
    this.item = item;
  }
}

export interface MentionPluginProps {
  search: MentionSearch;
  /** Fires once, synchronously with the insert, whenever a result is
   * actually selected (never while just typing/searching) — see
   * `mention.ts`'s header for what this is for. */
  onSelect?: (item: MentionItem) => void;
}

export default function MentionPlugin({ search, onSelect }: MentionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);
  const [results, setResults] = useState<MentionItem[]>([]);

  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("@", {
    minLength: 0,
  });

  // Re-runs the search whenever the query changes; the search function
  // itself may be async (a real vault search hitting the server), so this
  // can't just be a `useMemo`. `cancelled` guards against a slow, stale
  // search response landing after a newer one already has.
  useEffect(() => {
    if (queryString === null) {
      setResults([]);
      return;
    }
    let cancelled = false;
    Promise.resolve(search(queryString)).then((items) => {
      if (!cancelled) setResults(items);
    });
    return () => {
      cancelled = true;
    };
  }, [queryString, search]);

  const options = useMemo(
    () => results.map((item) => new MentionOption(item)),
    [results],
  );

  const onSelectOption = useCallback(
    (option: MentionOption, nodeToRemove: TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        const linkNode = $createLinkNode(option.item.path);
        linkNode.append($createTextNode(`@${option.item.name}`));
        if (nodeToRemove) {
          nodeToRemove.replace(linkNode);
        } else {
          $insertNodes([linkNode]);
        }
        const after = $createTextNode(" ");
        linkNode.insertAfter(after);
        after.select();
        closeMenu();
      });
      onSelect?.(option.item);
    },
    [editor, onSelect],
  );

  return (
    <LexicalTypeaheadMenuPlugin<MentionOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorElementRef.current && options.length > 0
          ? createPortal(
              <ul className="ox-mention-menu ox-tokens" role="listbox">
                {options.map((option, i) => (
                  <li
                    key={option.key}
                    ref={(el) => option.setRefElement(el)}
                    role="option"
                    aria-selected={selectedIndex === i}
                    className={`ox-mention-menu-item${
                      selectedIndex === i ? " ox-mention-menu-item--active" : ""
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => selectOptionAndCleanUp(option)}
                  >
                    {option.item.name}
                  </li>
                ))}
              </ul>,
              anchorElementRef.current,
            )
          : null
      }
    />
  );
}
