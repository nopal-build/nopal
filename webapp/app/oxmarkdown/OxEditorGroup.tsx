/**
 * Lets ArrowDown at the bottom of one `OxEditor` (Editing mode) jump the
 * caret into the top of the NEXT one in group order, and ArrowUp at the
 * top jump into the end of the PREVIOUS one — e.g. from a day's prose down
 * into its first Card, and on into the next Card after that. Each editor
 * stays a fully separate Lexical instance/document/undo history; this
 * only ever moves keyboard focus between them, purely a UX nicety for the
 * "Cards are separate files, but should still feel like part of one
 * continuous daily log" design (see the `oxmarkdown` skill).
 *
 * Usage: wrap the stack of `OxEditor`s with `<OxEditorGroup order={[...]}>`
 * — the ids in the EXACT order they render — and pass a matching
 * `groupId` prop to each `OxEditor` you want included. The group only
 * ever trusts this explicit `order` list, never mount order, since
 * editors can be added/removed/reordered independently of when they
 * happen to mount. An `OxEditor` without a `groupId`, or one outside any
 * `OxEditorGroup`, behaves exactly as before — this is entirely opt-in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type OxEditorGroupMember = {
  /** Moves this editor's caret to the very start of its document and
   * focuses it. */
  focusStart: () => void;
  /** Moves this editor's caret to the very end of its document and
   * focuses it. */
  focusEnd: () => void;
};

interface OxEditorGroupApi {
  register: (id: string, member: OxEditorGroupMember) => void;
  unregister: (id: string) => void;
  next: (id: string) => OxEditorGroupMember | null;
  prev: (id: string) => OxEditorGroupMember | null;
}

const OxEditorGroupContext = createContext<OxEditorGroupApi | null>(null);

/** Used by `CrossEditorArrowPlugin` — not meant to be called directly from
 * route/component code. Returns `null` outside any `OxEditorGroup`, which
 * `CrossEditorArrowPlugin` treats as "this feature is off" for that
 * editor. */
export function useOxEditorGroup(): OxEditorGroupApi | null {
  return useContext(OxEditorGroupContext);
}

export function OxEditorGroup({
  order,
  children,
}: {
  /** The group's ids in render order — the SAME order/ids you pass as
   * each member `OxEditor`'s `groupId`. Read fresh on every neighbor
   * lookup, so reordering/adding/removing editors works without needing
   * to re-mount this provider. */
  order: string[];
  children: ReactNode;
}) {
  const orderRef = useRef(order);
  orderRef.current = order;
  const members = useRef(new Map<string, OxEditorGroupMember>());

  const register = useCallback((id: string, member: OxEditorGroupMember) => {
    members.current.set(id, member);
  }, []);
  const unregister = useCallback((id: string) => {
    members.current.delete(id);
  }, []);
  const neighbor = useCallback((id: string, dir: 1 | -1): OxEditorGroupMember | null => {
    const list = orderRef.current;
    const idx = list.indexOf(id);
    if (idx === -1) return null;
    const targetId = list[idx + dir];
    return targetId !== undefined ? members.current.get(targetId) ?? null : null;
  }, []);

  const api = useMemo<OxEditorGroupApi>(
    () => ({
      register,
      unregister,
      next: (id) => neighbor(id, 1),
      prev: (id) => neighbor(id, -1),
    }),
    [register, unregister, neighbor],
  );

  return (
    <OxEditorGroupContext.Provider value={api}>{children}</OxEditorGroupContext.Provider>
  );
}
