// packages/stamps/src/SearchField.tsx
import type { ComponentProps } from "react";
import { Input } from "./Input";
import { searchFieldInput, searchFieldWrapper, searchIcon } from "./searchCollection.css";

/**
 * The one search bar: a stamp `Input` with the magnifier inside it. Every
 * search field uses this, standalone or inside `SearchCollection` (Austin,
 * 2026-09-28: stamps for all search bars). Its label is always hidden;
 * the placeholder says what it searches. A plain `<Input>` underneath, so
 * `name` puts it in a wrapping `<form>` like any other field.
 */
export function SearchField(props: Omit<ComponentProps<typeof Input>, "hideLabel" | "type">) {
  return (
    <div className={searchFieldWrapper}>
      <Input {...props} hideLabel className={[searchFieldInput, props.className].filter(Boolean).join(" ")} />
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={searchIcon}
      >
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    </div>
  );
}
