/**
 * Reference popover for the MDX editor.
 *
 * Typing `[` opens a typeahead popover anchored at the caret. As the user
 * keeps typing, the list narrows. It offers three kinds of references:
 *
 *   • CSV values  — from the project's CSV file → inserted as an inline,
 *                   click-to-edit value chip (see csvRefPlugin).
 *   • Pages       — markdown files in the Vault (searchable by folder path)
 *                   → inserted as a link to that page.
 *   • Files       — other vault files. Photos are embedded as an image
 *                   placement; everything else becomes a link to the file.
 */

import { realmPlugin, addComposerChild$ } from "@mdxeditor/editor";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createTextNode, $insertNodes, type TextNode } from "lexical";
import { $createLinkNode } from "@lexical/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CsvFieldsContext } from "./csvRefPlugin";
import { $createCsvRefNode } from "./csvRefPlugin";

// ── Types ────────────────────────────────────────────────────────────────────

/** A vault item that can be referenced from the editor. */
export interface VaultRefItem {
  id: string;
  /** Display name — usually the file name. */
  label: string;
  /** Secondary text used for display AND search — e.g. the folder path. */
  detail?: string;
  kind: "page" | "image" | "file";
  /** Link target for pages and non-image files. */
  href?: string;
  /** Image URL — used to embed photos. */
  url?: string;
}

export interface RefPopoverContextValue {
  items: VaultRefItem[];
  /**
   * Embeds an image into the document via the editor's file registry.
   * `afterParagraphIndex` is the paragraph gap the image lands in.
   */
  embedImage?: (item: VaultRefItem, afterParagraphIndex: number) => void;
}

export const RefPopoverContext = createContext<RefPopoverContextValue>({
  items: [],
});

// ── Options ──────────────────────────────────────────────────────────────────

type RefOptionData =
  | { type: "csv"; key: string; value: string }
  | { type: "item"; item: VaultRefItem };

class RefOption extends MenuOption {
  data: RefOptionData;

  constructor(data: RefOptionData) {
    super(data.type === "csv" ? `csv:${data.key}` : `item:${data.item.id}`);
    this.data = data;
  }
}

function optionIcon(data: RefOptionData): string {
  if (data.type === "csv") return "📊";
  if (data.item.kind === "page") return "📝";
  if (data.item.kind === "image") return "🖼️";
  return "📎";
}

function optionLabel(data: RefOptionData): string {
  return data.type === "csv" ? data.key : data.item.label;
}

function optionDetail(data: RefOptionData): string {
  if (data.type === "csv") return data.value || "—";
  return data.item.detail ?? "";
}

// ── Trigger: an unclosed `[` before the caret ────────────────────────────────

const TRIGGER_RE = /\[([^\[\]]{0,48})$/;

function checkForRefTrigger(text: string): MenuTextMatch | null {
  const match = TRIGGER_RE.exec(text);
  if (match === null) return null;
  return {
    leadOffset: match.index,
    matchingString: match[1],
    replaceableString: match[0],
  };
}

// ── Plugin component ─────────────────────────────────────────────────────────

const MAX_OPTIONS = 10;

function RefPopoverPluginComponent() {
  const [editor] = useLexicalComposerContext();
  const { fields } = useContext(CsvFieldsContext);
  const { items, embedImage } = useContext(RefPopoverContext);
  const [queryString, setQueryString] = useState<string | null>(null);

  const options = useMemo(() => {
    const q = (queryString ?? "").toLowerCase().trim();
    const matches = (hay: string) => hay.toLowerCase().includes(q);
    const starts = (hay: string) => hay.toLowerCase().startsWith(q);

    const csv: RefOption[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (!q || matches(key) || matches(value)) {
        csv.push(new RefOption({ type: "csv", key, value }));
      }
    }
    csv.sort((a, b) => {
      if (!q) return 0;
      return (
        Number(starts(optionLabel(b.data))) -
        Number(starts(optionLabel(a.data)))
      );
    });

    const byKind = (kind: VaultRefItem["kind"]) =>
      items
        .filter(
          (item) =>
            item.kind === kind &&
            (!q || matches(`${item.label} ${item.detail ?? ""}`)),
        )
        .sort((a, b) => Number(starts(b.label)) - Number(starts(a.label)))
        .map((item) => new RefOption({ type: "item", item }));

    return [
      ...csv,
      ...byKind("page"),
      ...byKind("image"),
      ...byKind("file"),
    ].slice(0, MAX_OPTIONS);
  }, [queryString, fields, items]);

  const onSelectOption = useCallback(
    (
      option: RefOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        const { data } = option;

        if (data.type === "csv") {
          const refNode = $createCsvRefNode(data.key);
          if (nodeToRemove) {
            nodeToRemove.replace(refNode);
          } else {
            $insertNodes([refNode]);
          }
          const after = $createTextNode(" ");
          refNode.insertAfter(after);
          after.select();
        } else if (data.item.kind === "image") {
          // Embed after the paragraph the caret is in.
          const topLevel = nodeToRemove?.getTopLevelElement();
          const blockIndex = topLevel ? topLevel.getIndexWithinParent() : 0;
          nodeToRemove?.remove();
          embedImage?.(data.item, blockIndex + 1);
        } else {
          const linkNode = $createLinkNode(data.item.href ?? "");
          linkNode.append($createTextNode(data.item.label));
          if (nodeToRemove) {
            nodeToRemove.replace(linkNode);
          } else {
            $insertNodes([linkNode]);
          }
          const after = $createTextNode(" ");
          linkNode.insertAfter(after);
          after.select();
        }

        closeMenu();
      });
    },
    [editor, embedImage],
  );

  return (
    <LexicalTypeaheadMenuPlugin<RefOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForRefTrigger}
      options={options}
      anchorClassName="ref-popover-anchor"
      menuRenderFn={(
        anchorElementRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorElementRef.current && options.length > 0
          ? createPortal(
              <ul className="ref-popover" role="listbox">
                {options.map((option, i) => (
                  <li
                    key={option.key}
                    ref={(el) => option.setRefElement(el)}
                    role="option"
                    aria-selected={selectedIndex === i}
                    className={`ref-popover-item${
                      selectedIndex === i ? " ref-popover-item--active" : ""
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => selectOptionAndCleanUp(option)}
                  >
                    <span className="ref-popover-icon">
                      {optionIcon(option.data)}
                    </span>
                    <span className="ref-popover-label">
                      {optionLabel(option.data)}
                    </span>
                    <span className="ref-popover-detail">
                      {optionDetail(option.data)}
                    </span>
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

// ── Plugin ───────────────────────────────────────────────────────────────────

export const refPopoverPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, RefPopoverPluginComponent);
  },
});
