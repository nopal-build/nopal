/**
 * `:::box{form-id="..." select-group="..." value="..."}` /
 * `::button{form-id="..." action="..."}` — the two real, mounted
 * components that read/write the shared `WebsiteFormContext` store
 * (`OxRenderer.tsx`'s `WebsiteFormProvider`). Option 4 ("centralized
 * storage, not centralized building") of the "Box Directive + Pricing
 * Card UI Fix" garden seed, Effort 2.
 *
 * Registry entries in `websiteDirectives.tsx` stay dumb plain functions
 * (confirmed constraint, see that file's own header) — `box`/`button`
 * both just hand off to a real component here that does the actual
 * `useContext` work, exactly the same shape `websiteBadge.tsx`'s
 * `WebsiteBadge`/`PositionedWebsiteBadge` already established for
 * Effort 1.
 */
import { useContext, type CSSProperties, type ReactNode } from "react";
import { WebsiteFormContext, type WebsiteFormValue } from "../components/OxRenderer";
import { Checkbox } from "stamps/Checkbox";

type BoxDirectiveProps = {
  /** `surface=`/`border=`/`margin=`'s already-resolved inline style,
   * computed by `websiteDirectives.tsx`'s `box()` registry entry via
   * `resolveSwatchRole`/`parseMarginStyle` — this component never touches
   * the swatch registry (or the margin token) directly, only the form
   * store. Named plainly `style`, not `surfaceStyle` (its original name,
   * back when background/border-color were the only two properties it
   * ever carried) — now that `margin=` rides along in the same object too,
   * the narrower name would undersell what it actually sets. */
  style: CSSProperties;
  formId?: string;
  selectGroup?: string;
  value?: string;
  /** `:::box{disabled="true"}` -- grays the box out (same `opacity: 0.67
   * cursor: not-allowed` convention `stamps/button.css.ts`'s own
   * `&:disabled` recipe already uses) and makes it unselectable: a click/
   * Space/Enter no-ops instead of writing into the shared form store, and
   * it drops out of the tab order entirely. Independent of `selectable`
   * below -- a disabled box still renders its own radio/content layout
   * exactly as any other selectable box would (so an author can show
   * "this option exists but isn't available yet" without it looking like
   * a totally different, unrelated box), just inert. */
  disabled?: boolean;
  children?: ReactNode;
};

/** A box becomes selectable only when `form-id`/`select-group`/`value`
 * are ALL given together — any box missing one renders exactly as
 * Effort 1's plain, unselectable box always has (same "missing required
 * attrs falls through unchanged" convention `::icon`/`::badge`'s own
 * optional attributes already use). Clicking (or Space/Enter, for
 * keyboard users) a selectable box writes `value` into the shared store
 * under `(formId, selectGroup)` — radio-style mutual exclusivity falls
 * out for free: every OTHER box sharing the same `(formId, selectGroup)`
 * reads the SAME context value, so only the one whose own `value`
 * currently matches it ever shows as selected.
 *
 * Known, accepted limitation (v1): boxes in one `select-group` are
 * plain, independently-rendered siblings, not wrapped in any shared
 * element this component owns — there's nowhere to put a single
 * `role="radiogroup"` ancestor, so each box only carries its own
 * `role="radio"`/`aria-checked` individually. Revisit if a real
 * accessibility gap is reported. */
export function BoxDirective({ style, formId, selectGroup, value, disabled, children }: BoxDirectiveProps) {
  const formApi = useContext(WebsiteFormContext);
  const selectable = Boolean(formId && selectGroup && value);
  const selected = selectable && formApi?.getValue(formId!, selectGroup!) === value;
  const interactive = selectable && !disabled;

  function select() {
    formApi?.setValue(formId!, selectGroup!, value!);
  }

  return (
    <div
      className={`website-box${selectable ? " website-box-selectable" : ""}${selected ? " website-box-selected" : ""}${disabled ? " website-box-disabled" : ""}`}
      style={style}
      role={selectable ? "radio" : undefined}
      aria-checked={selectable ? selected : undefined}
      aria-disabled={disabled ? true : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? select : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              // Space/Enter activation -- the same convention the
              // `oxmarkdown` skill's own interactables (task checkboxes,
              // directive attribute popovers) already use.
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                select();
              }
            }
          : undefined
      }
    >
      {selectable ? (
        <>
          {/* Presentational only (no `label`, see `Checkbox`'s own doc
              comment) -- this `<div>` already owns the real `role="radio"`/
              `aria-checked`/click/keyboard handling above; a second nested
              interactive control here would be invalid ARIA (a radio
              containing a checkbox) as well as redundant. `variant="radio"`
              -- these boxes are already mutually exclusive within their own
              `select-group` (picking one deselects every other), so the
              dot-in-ring look reads correctly, unlike a checkbox's own
              filled-square look. */}
          <span className="website-box-radio">
            <Checkbox checked={selected} variant="radio" />
          </span>
          <div className="website-box-content">{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
}

/** The second, mutually-exclusive mode of the existing `::button{...}`
 * directive (Effort 0's own decision — extend, not a new directive name:
 * same visual recipe, same `variant` set, only the click behavior
 * differs). `className`/`style` are passed in already-resolved from
 * `websiteDirectives.tsx`'s `button()` registry entry — the EXACT same
 * `stampsButton({ variant })` recipe + `WEBSITE_BUTTON_VARIANT_STYLE`
 * the `href` mode already uses, so a submit button looks identical to an
 * ordinary CTA link. Renders a real `<button type="button">`, never an
 * `<a>` — it fires a stateful POST, it never navigates. */
export function WebsiteFormButton({
  text,
  className,
  style,
  formId,
  action,
}: {
  text: string;
  className: string;
  style?: CSSProperties;
  formId: string;
  action: string;
}) {
  const formApi = useContext(WebsiteFormContext);
  return (
    <button type="button" className={className} style={style} onClick={() => formApi?.submit(formId, action)}>
      {text}
    </button>
  );
}

/** The third, mutually-exclusive mode of `::button{...}` (the
 * `meet-with-a-guide-calendly-link` garden seed): a real `<a>` that
 * still navigates (unlike mode 2's POST-and-stay button), but appends
 * whichever value is CURRENTLY selected in the shared `(formId,
 * selectGroup)` store as a `param=value` query param before navigating
 * -- e.g. a shared "Meet with a Guide" button carrying whichever pricing
 * box is selected through to a Calendly link as `?utm_content=...`.
 * Recomputed on every render (not just captured at mount), so the link
 * always reflects whatever's selected the moment it's actually clicked.
 * Falls back to the plain `href`, untouched, if nothing's selected yet
 * -- the simplest option, and this seed's own resolved decision; revisit
 * if that turns out to need its own signal (disabled, a prompt, ...). */
export function WebsiteFormLink({
  text,
  className,
  style,
  href,
  formId,
  selectGroup,
  param,
}: {
  text: string;
  className: string;
  style?: CSSProperties;
  href: string;
  formId: string;
  selectGroup: string;
  param: string;
}) {
  const formApi = useContext(WebsiteFormContext);
  const selected = asQueryValue(formApi?.getValue(formId, selectGroup));
  const url = selected ? `${href}${href.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(selected)}` : href;
  return (
    <a className={className} href={url} style={style}>
      {text}
    </a>
  );
}

/** A select-group box's own `value` is always a plain string in
 * practice (`BoxDirective` only ever calls `setValue(formId, selectGroup,
 * value)` with its own string `value` attr) -- `WebsiteFormValue`'s
 * wider `string | string[]` type is for other, unrelated future form
 * fields sharing the same store, not this one. The array case can't
 * meaningfully become a single query param, so it's treated the same as
 * "nothing selected yet" rather than guessed at. */
function asQueryValue(value: WebsiteFormValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
