/**
 * DUPLICATED from fruits/app/oxmarkdown/websiteForms.tsx -- see
 * `websiteIcons.tsx`'s own header comment here for why this whole
 * directory is duplicated. Not shared; keep both copies in sync by hand.
 *
 * `:::box{form-id="..." select-group="..." value="..."}` /
 * `::button{form-id="..." action="..."}` — the two real, mounted
 * components that read/write the shared `WebsiteFormContext` store
 * (`OxRenderer.tsx`'s `WebsiteFormProvider`). Option 4 ("centralized
 * storage, not centralized building") of the "Box Directive + Pricing
 * Card UI Fix" garden seed, Effort 2/3.
 *
 * Registry entries in `websiteDirectives.tsx` stay dumb plain functions
 * (confirmed constraint, see that file's own header) — `box`/`button`
 * both just hand off to a real component here that does the actual
 * `useContext` work, exactly the same shape `websiteBadge.tsx`'s
 * `WebsiteBadge`/`PositionedWebsiteBadge` already established for
 * Effort 1.
 */
import { useContext, type CSSProperties, type ReactNode } from "react";
import { WebsiteFormContext } from "../components/OxRenderer";

type BoxDirectiveProps = {
  /** `surface=`/`border=`'s already-resolved inline style, computed by
   * `websiteDirectives.tsx`'s `box()` registry entry via
   * `resolveSwatchRole` — this component never touches the swatch
   * registry directly, only the form store. */
  surfaceStyle: CSSProperties;
  formId?: string;
  selectGroup?: string;
  value?: string;
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
export function BoxDirective({ surfaceStyle, formId, selectGroup, value, children }: BoxDirectiveProps) {
  const formApi = useContext(WebsiteFormContext);
  const selectable = Boolean(formId && selectGroup && value);
  const selected = selectable && formApi?.getValue(formId!, selectGroup!) === value;

  function select() {
    formApi?.setValue(formId!, selectGroup!, value!);
  }

  return (
    <div
      className={`website-box${selectable ? " website-box-selectable" : ""}${selected ? " website-box-selected" : ""}`}
      style={surfaceStyle}
      role={selectable ? "radio" : undefined}
      aria-checked={selectable ? selected : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? select : undefined}
      onKeyDown={
        selectable
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
      {children}
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
