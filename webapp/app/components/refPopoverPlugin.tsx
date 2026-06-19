/**
 * Reference popover for the MDX editor.
 *
 * Typing `[[` opens a unified typeahead popover. As the user keeps typing the
 * list narrows. Typing `![[` instead opens it in "embed" mode.
 *
 * Link mode `[[`:
 *   • CSV values  — from the project's CSV file → inline click-to-edit chip
 *   • Pages       — markdown files in the Vault → wiki-link `[[Page name]]`
 *   • Images      — vault photos → markdown image link `[label](url)`
 *   • Files       — other vault files → markdown link `[label](href)`
 *   • Create new  — shown when query has no matching page → inserts `[[query]]`
 *
 * Embed mode `![[`:
 *   • Pages  → `![[Page name]]` (rendered as a page card)
 *   • Images → embedded via the file registry (existing behaviour)
 *   • Files  → `![[filename]]` (rendered as a file attachment card)
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
  useRef,
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

type TriggerMode = "link" | "embed";

type RefOptionData =
  | { type: "csv"; key: string; value: string }
  | { type: "item"; item: VaultRefItem }
  | { type: "create-page"; label: string };

class RefOption extends MenuOption {
  data: RefOptionData;

  constructor(data: RefOptionData) {
    if (data.type === "csv") super(`csv:${data.key}`);
    else if (data.type === "create-page") super(`create:${data.label}`);
    else super(`item:${data.item.id}`);
    this.data = data;
  }
}

function optionIcon(data: RefOptionData): string {
  if (data.type === "csv") return "📊";
  if (data.type === "create-page") return "✨";
  if (data.item.kind === "page") return "📝";
  if (data.item.kind === "image") return "🖼️";
  return "📎";
}

function optionLabel(data: RefOptionData): string {
  if (data.type === "csv") return data.key;
  if (data.type === "create-page") return `Create "[[${data.label}]]"`;
  return data.item.label;
}

function optionDetail(data: RefOptionData): string {
  if (data.type === "csv") return data.value || "—";
  if (data.type === "create-page") return "new page";
  return data.item.detail ?? "";
}

// ── Trigger: `[[query` or `![[query` before the caret ────────────────────────

// Matches "![[query" or "[[query" at the end of the text.
// Group 1 = the prefix ("![[" or "[["), group 2 = the query text.
const TRIGGER_RE = /(!?\[\[)([^\[\]]{0,48})$/;

// ── Plugin component ─────────────────────────────────────────────────────────

const MAX_OPTIONS = 10;

function RefPopoverPluginComponent() {
  const [editor] = useLexicalComposerContext();
  const { fields } = useContext(CsvFieldsContext);
  const { items, embedImage } = useContext(RefPopoverContext);
  const [queryString, setQueryString] = useState<string | null>(null);

  // Tracks which trigger prefix fired most recently.
  const triggerModeRef = useRef<TriggerMode>("link");

  const checkForTrigger = useCallback((text: string): MenuTextMatch | null => {
    const match = TRIGGER_RE.exec(text);
    if (!match) return null;
    triggerModeRef.current = match[1] === "![[" ? "embed" : "link";
    return {
      leadOffset: match.index,
      matchingString: match[2],
      replaceableString: match[0],
    };
  }, []);

  const options = useMemo(() => {
    const mode = triggerModeRef.current;
    const q = (queryString ?? "").toLowerCase().trim();
    const matches = (hay: string) => hay.toLowerCase().includes(q);
    const starts = (hay: string) => hay.toLowerCase().startsWith(q);

    const result: RefOption[] = [];

    // CSV — only in link mode
    if (mode === "link") {
      const csv: RefOption[] = [];
      for (const [key, value] of Object.entries(fields)) {
        if (!q || matches(key) || matches(value)) {
          csv.push(new RefOption({ type: "csv", key, value }));
        }
      }
      csv.sort((a, b) => {
        if (!q) return 0;
        const ad = a.data as { type: "csv"; key: string };
        const bd = b.data as { type: "csv"; key: string };
        return Number(starts(bd.key)) - Number(starts(ad.key));
      });
      result.push(...csv);
    }

    // Pages, images, files
    const byKind = (kind: VaultRefItem["kind"]) =>
      items
        .filter(
          (item) =>
            item.kind === kind &&
            (!q || matches(`${item.label} ${item.detail ?? ""}`)),
        )
        .sort((a, b) => Number(starts(b.label)) - Number(starts(a.label)))
        .map((item) => new RefOption({ type: "item", item }));

    result.push(...byKind("page"), ...byKind("image"), ...byKind("file"));

    // "Create new page" — only in link mode when there is a query
    if (mode === "link" && q) {
      result.push(
        new RefOption({ type: "create-page", label: queryString ?? q }),
      );
    }

    return result.slice(0, MAX_OPTIONS);
  }, [queryString, fields, items]);

  const onSelectOption = useCallback(
    (
      option: RefOption,
      nodeToRemove: TextNode | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        const { data } = option;
        const mode = triggerModeRef.current;

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
        } else if (data.type === "create-page") {
          const wikiText = $createTextNode(`[[${data.label}]]`);
          if (nodeToRemove) {
            nodeToRemove.replace(wikiText);
          } else {
            $insertNodes([wikiText]);
          }
          const after = $createTextNode(" ");
          wikiText.insertAfter(after);
          after.select();
        } else if (data.item.kind === "image") {
          if (mode === "embed") {
            const topLevel = nodeToRemove?.getTopLevelElement();
            const blockIndex = topLevel ? topLevel.getIndexWithinParent() : 0;
            nodeToRemove?.remove();
            embedImage?.(data.item, blockIndex + 1);
          } else {
            const linkNode = $createLinkNode(
              data.item.url ?? data.item.href ?? "",
            );
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
        } else if (data.item.kind === "page") {
          const label = data.item.label.replace(/\.md$/i, "");
          const syntax = mode === "embed" ? `![[${label}]]` : `[[${label}]]`;
          const wikiText = $createTextNode(syntax);
          if (nodeToRemove) {
            nodeToRemove.replace(wikiText);
          } else {
            $insertNodes([wikiText]);
          }
          const after = $createTextNode(" ");
          wikiText.insertAfter(after);
          after.select();
        } else {
          // file
          if (mode === "embed") {
            const wikiText = $createTextNode(`![[${data.item.label}]]`);
            if (nodeToRemove) {
              nodeToRemove.replace(wikiText);
            } else {
              $insertNodes([wikiText]);
            }
            const after = $createTextNode(" ");
            wikiText.insertAfter(after);
            after.select();
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
      triggerFn={checkForTrigger}
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
                    }${
                      option.data.type === "create-page"
                        ? " ref-popover-item--create"
                        : ""
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
