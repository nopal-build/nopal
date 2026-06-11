/**
 * CSV-reference plugin for the MDX editor.
 *
 * Markdown like `[location]` (where `location` is a key in the project's CSV
 * file) is rendered as an inline chip showing the CSV *value*. Clicking the
 * chip opens an inline input so the value can be edited in place — the edit
 * is written back to the CSV file, never to the markdown. On serialization
 * the chip exports as plain `[location]` again.
 */

import {
  realmPlugin,
  addComposerChild$,
  addLexicalNode$,
  addExportVisitor$,
  addToMarkdownExtension$,
  type LexicalExportVisitor,
} from "@mdxeditor/editor";
import {
  $applyNodeReplacement,
  DecoratorNode,
  TextNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type * as Mdast from "mdast";

// ── Context — supplies CSV data + the edit callback to chips ────────────────

export interface CsvFieldsContextValue {
  /** key → value map parsed from the project CSV file. */
  fields: Record<string, string>;
  /** Called when the user edits a value inline. */
  onChange?: (key: string, value: string) => void;
}

export const CsvFieldsContext = createContext<CsvFieldsContextValue>({
  fields: {},
});

// ── Chip component (rendered by the decorator node) ─────────────────────────

function CsvRefChip({ csvKey }: { csvKey: string }) {
  const { fields, onChange } = useContext(CsvFieldsContext);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const known = csvKey in fields;
  const value = fields[csvKey] ?? "";
  const empty = value.trim() === "";

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!onChange) return;
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange?.(csvKey, draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="csv-ref-input"
        value={draft}
        size={Math.max(draft.length, csvKey.length, 4)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Keep keystrokes away from Lexical
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      type="button"
      className={`csv-ref-chip${empty || !known ? " csv-ref-chip--empty" : ""}`}
      title={
        known
          ? `${csvKey} — click to edit`
          : `"${csvKey}" is not in the project CSV`
      }
      onClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {empty ? csvKey : value}
    </button>
  );
}

// ── Lexical node ─────────────────────────────────────────────────────────────

export type SerializedCsvRefNode = Spread<
  { csvKey: string },
  SerializedLexicalNode
>;

export class CsvRefNode extends DecoratorNode<ReactElement> {
  __csvKey: string;

  static getType(): string {
    return "csv-ref";
  }

  static clone(node: CsvRefNode): CsvRefNode {
    return new CsvRefNode(node.__csvKey, node.__key);
  }

  static importJSON(serialized: SerializedCsvRefNode): CsvRefNode {
    return $createCsvRefNode(serialized.csvKey);
  }

  constructor(csvKey: string, key?: NodeKey) {
    super(key);
    this.__csvKey = csvKey;
  }

  exportJSON(): SerializedCsvRefNode {
    return {
      type: "csv-ref",
      version: 1,
      csvKey: this.__csvKey,
    };
  }

  getCsvKey(): string {
    return this.__csvKey;
  }

  getTextContent(): string {
    return `[${this.__csvKey}]`;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "csv-ref-wrap";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  decorate(): ReactElement {
    return <CsvRefChip csvKey={this.__csvKey} />;
  }
}

export function $createCsvRefNode(csvKey: string): CsvRefNode {
  return $applyNodeReplacement(new CsvRefNode(csvKey));
}

export function $isCsvRefNode(
  node: LexicalNode | null | undefined,
): node is CsvRefNode {
  return node instanceof CsvRefNode;
}

// ── Text transform: turn `[key]` text into chips as it appears ──────────────

const REF_RE = /\[([^\[\]\n]+)\]/g;

function CsvRefTransformPlugin() {
  const [editor] = useLexicalComposerContext();
  const { fields } = useContext(CsvFieldsContext);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    if (!editor.hasNodes([CsvRefNode])) return;

    return editor.registerNodeTransform(TextNode, (node) => {
      if (!node.isSimpleText()) return;
      const text = node.getTextContent();

      REF_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = REF_RE.exec(text)) !== null) {
        const key = match[1];
        if (!(key in fieldsRef.current)) continue;

        const start = match.index;
        const end = start + match[0].length;
        let target: TextNode;
        if (start === 0) {
          [target] = node.splitText(end);
        } else {
          [, target] = node.splitText(start, end);
        }
        target.replace($createCsvRefNode(key));
        // Remaining text lives in sibling nodes which Lexical re-transforms.
        return;
      }
    });
  }, [editor]);

  return null;
}

// ── Markdown export ──────────────────────────────────────────────────────────

const CsvRefVisitor: LexicalExportVisitor<CsvRefNode, Mdast.Nodes> = {
  testLexicalNode: $isCsvRefNode,
  visitLexicalNode({ lexicalNode, mdastParent, actions }) {
    actions.appendToParent(mdastParent, {
      type: "csvRef",
      key: lexicalNode.getCsvKey(),
      // Custom mdast node type — serialized by the handler below.
    } as unknown as Mdast.PhrasingContent);
  },
};

// ── Plugin ───────────────────────────────────────────────────────────────────

export const csvRefPlugin = realmPlugin({
  init(realm) {
    realm.pub(addLexicalNode$, CsvRefNode);
    realm.pub(addExportVisitor$, CsvRefVisitor);
    realm.pub(addToMarkdownExtension$, {
      handlers: {
        // Emit the reference verbatim so the stored markdown stays `[key]`
        // instead of the escaped `\[key]` a text node would produce.
        // (cast: "csvRef" is a custom node type unknown to mdast's Handlers)
        csvRef: (node: { key: string }) => `[${node.key}]`,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    realm.pub(addComposerChild$, CsvRefTransformPlugin);
  },
});
