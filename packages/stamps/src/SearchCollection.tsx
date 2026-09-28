// packages/stamps/src/SearchCollection.tsx
import type { ReactNode } from "react";
import type { Input } from "./Input";
import { box, divider, footerArea, well } from "./searchCollection.css";
import { SearchField } from "./SearchField";
import { Surface } from "./Surface";

type SearchCollectionProps<T> = {
  /** Full item list — used for the default `renderItem` path. Pass `[]` and
   * use `resultsSlot` instead if you need custom grouping/empty states. */
  items?: T[];
  getKey?: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  /**
   * Escape hatch: fully custom markup for the scrollable list area — empty
   * states, "no results" states, grouped sections (e.g. active vs. revoked),
   * or a "+ Add {query}" affordance. When provided, this replaces the
   * built-in `items.map(renderItem)` / `emptyState` behavior entirely. See
   * the Relationships list in `fruits_.profile.tsx` for a full example.
   */
  resultsSlot?: ReactNode;
  /** Shown in the list area when `items` is empty and no `resultsSlot` is given. */
  emptyState?: ReactNode;
  /**
   * Props for the search field at the bottom of the box (`SearchField`,
   * a plain `<Input>` under the hood (so it participates in a wrapping `<Form>` via
   * `name` like any other field) — pass `value`/`defaultValue` + `onChange`
   * to drive filtering.
   */
  searchInputProps: Omit<React.ComponentProps<typeof Input>, "hideLabel" | "type">;
  /** Rendered under the search input — inline errors, hints, etc. */
  footer?: ReactNode;
  /** Height of the scrollable list area. Defaults to `380px`. */
  height?: number | string;
};

/**
 * A `Surface` shell for "search/filter a list, and optionally add a new
 * entry" UI: a fixed-height scrollable list on top, a divider, and a search
 * field below. Use this instead of hand-rolling the list+search+divider
 * layout whenever a page needs to search an existing collection and/or
 * create a new item from the same input (relationships, team members,
 * tags, file pickers, etc).
 *
 * This component owns layout only, not data — it doesn't fetch or submit
 * anything. Wrap it in a `<Form>` yourself if the search field should also
 * add/create on submit (see Relationships in `fruits_.profile.tsx`).
 */
export function SearchCollection<T>({
  items = [],
  getKey,
  renderItem,
  resultsSlot,
  emptyState,
  searchInputProps,
  footer,
  height = 380,
}: SearchCollectionProps<T>) {
  return (
    <Surface className={box}>
      <div className={well} style={{ height }}>
        {resultsSlot !== undefined
          ? resultsSlot
          : items.length === 0
            ? emptyState
            : items.map((item) => (
                <div key={getKey ? getKey(item) : undefined}>
                  {renderItem?.(item)}
                </div>
              ))}
      </div>

      <hr className={divider} />

      <div className={footerArea}>
        <SearchField {...searchInputProps} />

        {footer}
      </div>
    </Surface>
  );
}
