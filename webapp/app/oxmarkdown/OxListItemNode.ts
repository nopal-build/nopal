/**
 * A checklist item, fully owned by us — replaces `@lexical/list`'s native
 * checkbox mechanism entirely, after that mechanism caused the same class
 * of bug twice: `@lexical/list` ties "is this a checkbox" to the whole
 * LIST's declared type (`"check"` vs `"bullet"`), not the item. That's a
 * real, structural limitation (confirmed directly against its source, not
 * assumed) — there's no supported way for one item in a checklist to
 * render as a plain bullet while its siblings stay checkboxes. A previous
 * attempt worked around this by splitting the downgraded item into a
 * second, separate `<ul>` — which LOOKED fine, but produced a markdown
 * mismatch the render never showed: two adjacent lists of the same type
 * force `mdast-util-to-markdown`'s own disambiguation (an extra blank line
 * AND a switched bullet character, confirmed directly), completely
 * invisible in the editor. That's the actual thing being fixed here: the
 * editor must never render something the exported markdown doesn't
 * actually say, in either direction.
 *
 * So: we NEVER use `@lexical/list`'s `"check"` list type at all. Every
 * checklist-capable list is an ordinary `"bullet"` list; whether a given
 * ITEM has a checkbox is entirely this class's own `checked` field,
 * decoupled from the parent list. `isRealCheckbox()` is the ONE function
 * both rendering (`updateOxCheckboxDOM`, below) and export
 * (`editingTransforms.ts`'s `exportListItem`) call to decide whether a
 * checkbox is shown/emitted — they can't disagree, because there's only
 * one source of truth. That function also encodes the one real, upstream
 * constraint that can't be engineered around: GFM cannot represent a
 * checkbox on an item with no text at all (confirmed against both the
 * parser and serializer source, and a second independent implementation),
 * so an empty item is never SHOWN as a checkbox either — no exceptions,
 * no CSS fallback keyed on incidental DOM shape like a previous attempt.
 *
 * A REAL, confirmed-by-testing trap this class works around deliberately:
 * `ListItemNode`'s modern `$config()` API registers a `$transform` that
 * unconditionally clears the base `__checked` field whenever the parent
 * list isn't `"check"`-type — correct for the base class's own model
 * (checked is meaningless there), actively destructive for ours (every
 * list we make IS "not check-type", always, by design). Overriding
 * `$config()` to omit that transform did NOT stop it from running
 * (confirmed directly with real logging, not assumed — `$config()`'s
 * inheritance/merge behavior across a subclass chain isn't something to
 * rely on without deeper certainty than reading the types gave). The
 * robust fix is simpler and doesn't depend on that behavior at all: use an
 * entirely SEPARATE field (`__oxChecked`) that the base class's transform
 * has no reason to ever touch, and never let a real value reach the base's
 * own `__checked` field in the first place (the constructor always passes
 * `undefined` for it) — so that transform's own guard clause
 * (`if (node.__checked == null) return`) makes it a permanent, harmless
 * no-op for every instance of this class, regardless of how `$config()`
 * inheritance actually works under the hood.
 */

import { $applyNodeReplacement, type LexicalNode, type NodeKey, type RangeSelection } from "lexical";
import { ListItemNode, type SerializedListItemNode } from "@lexical/list";
import type { EditorConfig } from "lexical";

export class OxListItemNode extends ListItemNode {
  __oxChecked?: boolean;

  constructor(value?: number, checked?: boolean, key?: NodeKey) {
    // Deliberately never pass `checked` to `super` — see this file's
    // header. The base field (`__checked`) stays permanently `undefined`;
    // our own field (`__oxChecked`) is the only thing that ever means
    // anything for this class.
    super(value, undefined, key);
    this.__oxChecked = checked;
  }

  static getType(): string {
    return "ox-listitem";
  }

  static clone(node: OxListItemNode): OxListItemNode {
    return new OxListItemNode(node.__value, node.__oxChecked, node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__oxChecked = prevNode.__oxChecked;
  }

  static importJSON(serializedNode: SerializedListItemNode): OxListItemNode {
    return $createOxListItemNode(serializedNode.checked ?? undefined).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedListItemNode {
    return { ...super.exportJSON(), type: "ox-listitem" };
  }

  /** Deliberately NOT `super.getChecked()` — the base implementation
   * returns `undefined` whenever the parent list isn't `"check"`-type,
   * which for us is ALWAYS (see this file's header), so the inherited
   * version would report "no checkbox" for every item, unconditionally.
   * Our own `__oxChecked` field means exactly what it says regardless of
   * the parent list. */
  getChecked(): boolean | undefined {
    return this.getLatest().__oxChecked;
  }

  setChecked(checked?: boolean): this {
    const self = this.getWritable();
    self.__oxChecked = checked;
    return self;
  }

  /** The one shared predicate — see this file's header. Just
   * `checked !== undefined` — does NOT require real text. Two earlier
   * attempts got this wrong in OPPOSITE directions before landing here:
   * requiring text made an empty item's checkbox silently disappear
   * (wrong — pressing Enter to continue a checklist is the single most
   * common action, not an edge case); dropping the requirement WITHOUT
   * also fixing export made the render lie about what the markdown could
   * contain (also wrong, for the opposite reason). The actual fix is in
   * `editingTransforms.ts`'s `exportListItem`: an empty checkbox item
   * exports with a real, literal `[ ]`/`[x]` via an invisible zero-width-
   * space placeholder (confirmed directly to round-trip exactly, not
   * assumed) — so by the time this predicate runs, "checked !== undefined"
   * and "the markdown will actually say so" are simply the same fact,
   * with no exception needed on either side. */
  isRealCheckbox(): boolean {
    return this.getChecked() !== undefined;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    this.updateOxCheckboxDOM(dom);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const dirty = super.updateDOM(prevNode, dom, config);
    this.updateOxCheckboxDOM(dom);
    return dirty;
  }

  /** Runs AFTER `super`'s own DOM update — `super`'s theme-class/marker
   * logic already runs unconditionally (harmlessly, since our shared
   * theme config defines no `list.listitem`/`"check"`-type classes at
   * all), so this only ever needs to ADD our own checkbox-specific
   * classes/attributes on top, never remove something `super` added. */
  private updateOxCheckboxDOM(dom: HTMLElement): void {
    const isCheckbox = this.isRealCheckbox();
    dom.classList.toggle("ox-task-item", isCheckbox);
    dom.classList.toggle("ox-task-item-editing--checked", isCheckbox && this.getChecked() === true);
    dom.classList.toggle("ox-task-item-editing--unchecked", isCheckbox && this.getChecked() === false);
    if (isCheckbox) {
      dom.setAttribute("role", "checkbox");
      dom.setAttribute("tabIndex", "-1");
      dom.setAttribute("aria-checked", this.getChecked() ? "true" : "false");
    } else {
      dom.removeAttribute("role");
      dom.removeAttribute("tabIndex");
      dom.removeAttribute("aria-checked");
    }
  }

  /** Continuing a checkbox item via Enter (non-empty content — Enter on
   * EMPTY content is handled separately, see `OxChecklistPlugin.tsx`)
   * always continues AS a fresh, unchecked checkbox, whether the SOURCE
   * item was checked or unchecked. The base `ListItemNode`'s own version
   * of this (`this.getChecked() ? false : undefined`) only gets the
   * "source was checked" case right — continuing from an UNCHECKED item
   * there silently loses the checkbox entirely, a real upstream quirk
   * this fixes outright rather than patching after the fact. */
  insertNewAfter(_selection: RangeSelection | null, restoreSelection = true): OxListItemNode {
    const newElement = $createOxListItemNode()
      .updateFromJSON(this.exportJSON())
      .setChecked(this.getChecked() !== undefined ? false : undefined);
    this.insertAfter(newElement, restoreSelection);
    return newElement;
  }
}

export function $createOxListItemNode(checked?: boolean): OxListItemNode {
  return $applyNodeReplacement(new OxListItemNode(undefined, checked));
}

export function $isOxListItemNode(node: LexicalNode | null | undefined): node is OxListItemNode {
  return node instanceof OxListItemNode;
}

/** Walks up from any node to the nearest `OxListItemNode` ancestor (or
 * itself), if any — used by click/keyboard handlers that only have a DOM
 * target or a plain selection anchor to start from. */
export function $getNearestOxListItemNode(node: LexicalNode | null): OxListItemNode | null {
  let current: LexicalNode | null = node;
  while (current !== null) {
    if ($isOxListItemNode(current)) return current;
    current = current.getParent();
  }
  return null;
}
