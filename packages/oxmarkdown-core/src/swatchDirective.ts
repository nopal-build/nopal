/**
 * `::swatch{...}` / `::palette{...}` — OxMarkdown's shared color-theming
 * framework (see the "Oxmarkdown Colors" garden seed, `garden/growing/
 * oxmarkdown-colors.md`, for the full design history — rounds 1-13). A
 * `::swatch` registers one named, role-scoped color (light + dark
 * values); a `::palette` bundles one already-registered swatch name per
 * role under one friendly "look" name. Both are LEAF directives (own
 * line, no children) that render nothing themselves — registering a
 * swatch/palette is a pure side effect of a document containing one,
 * consumed by whichever OTHER directive (`:::section`, `section-title`,
 * a future `::box`, ...) resolves a role against the registry this file
 * builds.
 *
 * Framework-agnostic (no React import) — same reasoning as
 * `cardDirective.ts`/`refDirective.ts`: the actual rendering/CSS
 * injection happens in `OxRenderer.tsx`, but this FRAMEWORK is core, not
 * website-only (round 9) — the registration/parsing/cascade logic needs
 * zero DOM/React to be correct, and is fully unit-testable on its own.
 */

import type { DirectiveNode, LeafDirective, OxDocument } from "./document";
import { directiveAttrs } from "./document";

// ── Roles ────────────────────────────────────────────────────────────────

/** The fixed set of color "roles" (round 5) — each maps to one real CSS
 * property a consuming directive paints with (`background-color`/
 * `color`/`border-color`/`box-shadow` respectively). Deliberately NOT
 * open-ended, unlike a swatch's own `name`: a role has to correspond to
 * an actual paintable CSS concept for a consuming directive to attach it
 * to, so an author-invented role would have nowhere to render. */
export const SWATCH_ROLES = ["surface", "color", "border", "shadow"] as const;
export type SwatchRole = (typeof SWATCH_ROLES)[number];

function isSwatchRole(value: string | undefined): value is SwatchRole {
  return !!value && (SWATCH_ROLES as readonly string[]).includes(value);
}

// ── Attribute shapes ─────────────────────────────────────────────────────

/** One `::swatch{role="..." name="..." light="..." dark="..."}` registration. */
export interface SwatchAttrs {
  role: SwatchRole;
  /** Fully author-chosen, open vocabulary (round 3) — resolved against
   * its OWN role's namespace, not one flat name space: a "farground"
   * SURFACE and a "farground" COLOR are two unrelated registrations. */
  name: string;
  light: string;
  dark: string;
}

/** One `::palette{name="..." surface="..." color="..." border="..."
 * shadow="..."}` registration — a composite bundling one already-
 * registered swatch NAME per role under one friendly "look" name.
 * Omitted roles simply aren't set (`Partial`) — a consumer falls back to
 * its own default for that role, same as if `palette=` were never given
 * at all for that one role (round 4). */
export type PaletteAttrs = { name: string } & Partial<Record<SwatchRole, string>>;

// ── Value grammar (round 13) ─────────────────────────────────────────────
// `light=`/`dark=` are interpolated directly into generated CSS text at
// render time (unlike every OLDER color mechanism in this codebase, which
// only ever selects a pre-written className/attribute value) — so, by
// deliberate decision, only a closed set of safe, portable color-value
// SHAPES is accepted, checked once here at parse time. Anything else is
// treated exactly like a missing attribute (the whole `::swatch`
// registration is dropped) rather than being escaped/sanitized — simpler,
// and there is no legitimate authoring need for anything outside this
// grammar. Bare CSS named colors (`red`, `transparent`, ...) are
// DELIBERATELY excluded, on purpose, not an oversight: a bare CSS keyword
// is a concept specific to the CSS language, with no obvious portable
// equivalent if OxMarkdown ever renders on a non-CSS surface (a native
// macOS/Android app) — `var(--token)`/hex/`rgb()`/`rgba()` all represent
// portable, universal color primitives any future renderer could
// reasonably reinterpret in its own terms. A side effect worth naming
// explicitly: none of these three shapes can ever contain `<`, `/`, `;`,
// `{`, or `}`, so there is no separate "don't let a value close the
// generated `<style>` tag early" concern to handle elsewhere — the
// grammar itself already rules that out.
const SWATCH_VAR_PATTERN = /^var\(--[a-zA-Z0-9-]+\)$/;
const SWATCH_HEX_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SWATCH_RGB_PATTERN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/;

/** Whether a `light=`/`dark=` value is one of the three accepted shapes —
 * a `var(--token)` reference, a hex color, or `rgb()`/`rgba()` with plain
 * numeric components. See the grammar comment above for why this is
 * deliberately narrower than "anything valid CSS would accept." */
export function isSafeSwatchColorValue(value: string): boolean {
  return SWATCH_VAR_PATTERN.test(value) || SWATCH_HEX_PATTERN.test(value) || SWATCH_RGB_PATTERN.test(value);
}

// ── Directive identification + parsing ───────────────────────────────────

export function isSwatchDirective(node: { type: string; name?: string }): node is LeafDirective {
  return node.type === "leafDirective" && node.name === "swatch";
}

export function isPaletteDirective(node: { type: string; name?: string }): node is LeafDirective {
  return node.type === "leafDirective" && node.name === "palette";
}

/** Reads a parsed `::swatch{...}` node's attributes, or `null` if it's
 * missing a required field, names an unrecognized `role`, or either color
 * value fails the safety grammar above — tolerant of a malformed/
 * hand-edited directive rather than throwing, same convention
 * `refDirective.ts`'s `parseRefAttrs` already follows. A `null` result
 * means this registration is dropped entirely (round 13): a malformed
 * `::swatch` is never partially registered, and never visibly flagged —
 * it's exactly as if it were never written. */
export function parseSwatchAttrs(node: DirectiveNode): SwatchAttrs | null {
  const attrs = directiveAttrs(node);
  const role = attrs.role;
  const name = attrs.name;
  const light = attrs.light;
  const dark = attrs.dark;
  if (!isSwatchRole(role) || !name || !light || !dark) return null;
  if (!isSafeSwatchColorValue(light) || !isSafeSwatchColorValue(dark)) return null;
  return { role, name, light, dark };
}

/** Reads a parsed `::palette{...}` node's attributes, or `null` if it has
 * no `name`. Every role attribute is optional — a palette with none set
 * is unusual but not invalid (same tolerant spirit as `parseSwatchAttrs`). */
export function parsePaletteAttrs(node: DirectiveNode): PaletteAttrs | null {
  const attrs = directiveAttrs(node);
  const name = attrs.name;
  if (!name) return null;
  const result: PaletteAttrs = { name };
  for (const role of SWATCH_ROLES) {
    const value = attrs[role];
    if (value) result[role] = value;
  }
  return result;
}

// ── Registry ──────────────────────────────────────────────────────────────

export interface SwatchRegistry {
  /** One Map per role — `(role, name)` is the real key, not a single flat
   * namespace (round 4): a "farground" SURFACE and a "farground" COLOR
   * are unrelated registrations. */
  swatches: Map<SwatchRole, Map<string, { light: string; dark: string }>>;
  palettes: Map<string, PaletteAttrs>;
}

export function createEmptySwatchRegistry(): SwatchRegistry {
  const swatches = new Map<SwatchRole, Map<string, { light: string; dark: string }>>();
  for (const role of SWATCH_ROLES) swatches.set(role, new Map());
  return { swatches, palettes: new Map() };
}

/** Walks a document's own TOP-LEVEL children ONLY (round 13) — the exact
 * same restriction `OxRenderer.tsx`'s existing `collectDefinitions`
 * already applies for link definitions — collecting every `::swatch`/
 * `::palette` registration into one registry. A `::swatch`/`::palette`
 * written INSIDE a container directive's own body (a `:::section{...}`,
 * say) is not recognized here at all: it still renders as nothing
 * wherever `OxRenderer` encounters it (any built-in leaf-directive
 * kind always does), but it never registers — harmless, not an error.
 * Defining swatches at the very start of a document is the main real use
 * case, and it's already top-level by construction.
 *
 * **KNOWN, ACCEPTED LIMITATION (round 15/16 of the "Oxmarkdown Colors"
 * garden seed), confirmed by a real test
 * (`fruits/app/tests/swatchIncludeOx.test.tsx`)**: this does NOT extend
 * to a shared `_theme.md` included via `::include-ox{file="..."}` the
 * way an earlier draft of this comment assumed it would —
 * `::include-ox` (website-scoped, not a core concept at all) mounts the
 * included file as a genuinely separate, freshly-parsed `<OxRenderer>`
 * instance; THAT instance's own call to this function only ever sees
 * the included file's OWN top-level children, building a registry the
 * INCLUDING page's own `OxTreeRenderer` never reaches. A `::swatch`
 * defined in an included file is only ever usable by consuming
 * directives inside that SAME included file — never by the page that
 * includes it. Deliberately accepted as-is, not fixed: an author who
 * wants shared colors across multiple pages defines `::swatch`/
 * `::palette` directly at EACH page's own top level instead of via one
 * shared include.
 *
 * Registration order is DOCUMENT order, and a later `::swatch`/`::palette`
 * registering the SAME `(role, name)` / palette `name` simply overwrites
 * the earlier one in the Map — this is round 3's "later registration
 * wins, same mental model as CSS cascade/overrides" behavior, and it
 * falls out of this function for free with no extra bookkeeping. */
export function collectSwatchRegistry(doc: OxDocument): SwatchRegistry {
  const registry = createEmptySwatchRegistry();
  for (const node of doc.children) {
    const n = node as { type: string; name?: string };
    if (isSwatchDirective(n)) {
      const parsed = parseSwatchAttrs(node as unknown as DirectiveNode);
      if (parsed) {
        registry.swatches.get(parsed.role)!.set(parsed.name, { light: parsed.light, dark: parsed.dark });
      }
    } else if (isPaletteDirective(n)) {
      const parsed = parsePaletteAttrs(node as unknown as DirectiveNode);
      if (parsed) registry.palettes.set(parsed.name, parsed);
    }
  }
  return registry;
}

// ── Naming (round 13) ─────────────────────────────────────────────────────

/** Lowercases and replaces every run of non `[a-z0-9]` characters with a
 * single `-`, trimming leading/trailing dashes — turns an open,
 * author-chosen `name=` into a safe fragment for a CSS custom-property
 * name or a scoping class, so it can never contain `;`/`{`/`}`/whitespace/
 * quotes and break out of either position. Falls back to the literal
 * string `"x"` for a name that slugifies to nothing at all (e.g. `"###"`),
 * so a `--ox-swatch-<role>-` with a dangling, empty final segment never
 * actually ships. */
export function slugifySwatchName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "x";
}

/** The real CSS custom-property name a `(role, name)` swatch resolves to
 * — deliberately a SEPARATE namespace from the base viewer tokens
 * (`--ox-color-*`, `.ox-tokens`, round 7): swatches never redefine/
 * extend those, even though a swatch's `light=`/`dark=` value MAY
 * reference one as its source. */
export function swatchVarName(role: SwatchRole, name: string): string {
  return `--ox-swatch-${role}-${slugifySwatchName(name)}`;
}

// ── Cascade resolution (round 8) ──────────────────────────────────────────

export interface ResolveSwatchRoleOptions {
  role: SwatchRole;
  /** Omittable so a rendering layer can always call this the same way
   * regardless of whether the current document registered any
   * swatches at all — when omitted, steps 2/3 are simply skipped and
   * this always falls straight through to `fallback`, same as an
   * empty registry would. */
  registry?: SwatchRegistry;
  /** An explicit per-role attribute on the consuming directive itself
   * (e.g. `:::section{surface="farground"}`'s `"farground"`) — a swatch
   * NAME to look up, not a literal CSS value. Wins outright over
   * `palette` and `fallback` when it resolves (step 3). */
  explicit?: string;
  /** A `palette="..."` reference's own NAME, if the consuming directive
   * was given one — supplies a value for this role only if the named
   * palette itself defines one (step 2). */
  palette?: string;
  /** The consuming directive's own built-in default for this role (step
   * 1) — used only when neither `explicit` nor `palette` supplies a
   * resolvable value. A plain CSS value (or `undefined`, meaning "don't
   * set this property at all"), NOT a swatch name. */
  fallback?: string;
}

/** The one shared implementation of round 8's three-step cascade — every
 * consuming directive (today: `:::section`/`section-title`; future:
 * `::box`, ...) calls this instead of hand-rolling its own
 * default/palette/explicit precedence. Each step only applies if the one
 * before it didn't already supply a value:
 *
 *   1. `fallback` — the directive's own built-in default.
 *   2. `palette` — a named palette's value for this role, if it has one.
 *   3. `explicit` — an explicit per-role attribute, if it resolves.
 *
 * An `explicit`/`palette`-referenced NAME that was never registered via
 * `::swatch`/`::palette` — including one that WAS written but failed
 * `parseSwatchAttrs`'s own validation — is NOT an error and does NOT fall
 * back to any kind of visible "unknown" marker (round 13, closing the
 * spec's old open question 3 the opposite way an earlier draft of this
 * plan proposed): it's treated exactly as if that attribute had never
 * been given at all, falling through to the next step down. */
export function resolveSwatchRole(opts: ResolveSwatchRoleOptions): string | undefined {
  const { role, registry, explicit, palette, fallback } = opts;

  if (registry && explicit) {
    const resolved = resolveSwatchName(registry, role, explicit);
    if (resolved) return resolved;
  }

  if (registry && palette) {
    const name = registry.palettes.get(palette)?.[role];
    if (name) {
      const resolved = resolveSwatchName(registry, role, name);
      if (resolved) return resolved;
    }
  }

  return fallback;
}

function resolveSwatchName(registry: SwatchRegistry, role: SwatchRole, name: string): string | undefined {
  const entry = registry.swatches.get(role)?.get(name);
  return entry ? `var(${swatchVarName(role, name)})` : undefined;
}

// ── Render-time CSS emission ──────────────────────────────────────────────

/** Builds the literal CSS text for every swatch currently registered —
 * one declaration per `(role, name)` pair, light values under
 * `scopeSelector` directly and dark values under the same selector inside
 * an `@media (prefers-color-scheme: dark)` block. Returns `""` (render
 * nothing at all) when the registry has no swatches.
 *
 * Deliberately framework- and selector-agnostic — `scopeSelector` is
 * supplied by the CALLER (the rendering layer, e.g. `OxRenderer.tsx`),
 * never hardcoded to `.ox-content` here: a real page can render more than
 * one independent OxMarkdown document at once (a Daily Log's Cards are
 * each their own nested `OxRenderer`/`.ox-content` instance). If two such
 * documents each registered an UNRELATED swatch under the same `name`, a
 * shared/reused selector would let whichever `<style>` tag happens to sit
 * later in the page silently clobber the other document's own value — a
 * plain class selector matches every element with that class on the
 * ENTIRE page, not just the one document that generated it. The
 * rendering layer is responsible for generating a genuinely
 * unique-per-document selector (e.g. a React `useId()`-derived class) and
 * passing it in here; this function only ever emits valid-looking CSS, it
 * does not generate or guarantee selector uniqueness itself.
 *
 * Re-validates every value against `isSafeSwatchColorValue` again here
 * (belt-and-suspenders) rather than trusting the registry was built
 * exclusively via `collectSwatchRegistry`/`parseSwatchAttrs` — cheap
 * insurance against a future caller constructing a `SwatchRegistry` by
 * hand (e.g. a server-side writer, mirroring `cardDirective.ts`'s own
 * append/remove helpers) without going through that parser. */
export function buildSwatchStyleSheet(registry: SwatchRegistry, scopeSelector: string): string {
  const lightDecls: string[] = [];
  const darkDecls: string[] = [];
  for (const role of SWATCH_ROLES) {
    const byName = registry.swatches.get(role);
    if (!byName) continue;
    for (const [name, { light, dark }] of byName) {
      if (!isSafeSwatchColorValue(light) || !isSafeSwatchColorValue(dark)) continue;
      const varName = swatchVarName(role, name);
      lightDecls.push(`${varName}: ${light};`);
      darkDecls.push(`${varName}: ${dark};`);
    }
  }
  if (lightDecls.length === 0) return "";
  return [
    `${scopeSelector} { ${lightDecls.join(" ")} }`,
    `@media (prefers-color-scheme: dark) { ${scopeSelector} { ${darkDecls.join(" ")} } }`,
  ].join("\n");
}
