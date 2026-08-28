/**
 * OxMarkdown theme contract — a small, typed set of overridable tokens.
 * `styles/oxmarkdown.css` defines sensible defaults (nopal's existing
 * palette, system font stack, the 41px grid) directly in CSS, so the
 * editor looks right with zero configuration. This module exists so a
 * caller can override *specific* tokens — a different font to try out, an
 * accent color, a tighter grid — without touching the stylesheet, by
 * setting inline CSS custom properties that take precedence over the
 * file's defaults for exactly the tokens supplied.
 *
 * No React import — this is plain data + a pure function, usable from a
 * React `style` prop or anywhere else that can set CSS custom properties.
 */

export interface OxTheme {
  /** e.g. try a monospace/typewriter font — see the "typewriter font" TODO
   * in the oxmarkdown skill. */
  fontFamily?: string;
  fontWeight?: string | number;
  letterSpacing?: string;
  /** The dot-grid cell size — line-heights and heading margins are all
   * multiples of this. Change it here rather than hunting for `41px`. */
  grid?: string;
  colorText?: string;
  colorHeading?: string;
  colorAccent?: string;
  colorSubtle?: string;
  colorGridDot?: string;
  colorCodeBg?: string;
  colorBorder?: string;
  /** Selected-interactable highlight — new in OxMarkdown, no old-system
   * equivalent (see the `oxmarkdown` skill's "Interactables" section). */
  colorSelectedBg?: string;
  colorSelectedBorder?: string;
  colorUnknown?: string;
}

/** Maps each `OxTheme` key to the CSS custom property it controls. Keep in
 * sync with the `:root`/`.ox-content` defaults in `styles/oxmarkdown.css`. */
export const OX_THEME_VARS: Record<keyof OxTheme, string> = {
  fontFamily: "--ox-font-family",
  fontWeight: "--ox-font-weight",
  letterSpacing: "--ox-letter-spacing",
  grid: "--ox-grid",
  colorText: "--ox-color-text",
  colorHeading: "--ox-color-heading",
  colorAccent: "--ox-color-accent",
  colorSubtle: "--ox-color-subtle",
  colorGridDot: "--ox-color-grid-dot",
  colorCodeBg: "--ox-color-code-bg",
  colorBorder: "--ox-color-border",
  colorSelectedBg: "--ox-color-selected-bg",
  colorSelectedBorder: "--ox-color-selected-border",
  colorUnknown: "--ox-color-unknown",
};

/**
 * Converts a (partial) theme into a plain object of CSS custom properties,
 * suitable for spreading into a React `style` prop. Omitted keys are left
 * out entirely, so they fall through to whatever `oxmarkdown.css` (or an
 * ancestor's inline override) already defines — this only ever overrides
 * the specific tokens supplied.
 */
export function themeToStyle(theme: OxTheme): Record<string, string> {
  const style: Record<string, string> = {};
  for (const key of Object.keys(theme) as (keyof OxTheme)[]) {
    const value = theme[key];
    if (value !== undefined) style[OX_THEME_VARS[key]] = String(value);
  }
  return style;
}
