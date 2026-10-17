/**
 * `::swatch{...}` / `::palette{...}` — the core color-theming framework
 * (`oxmarkdown-core/src/swatchDirective.ts`). See the "Oxmarkdown Colors"
 * garden seed (`garden/growing/oxmarkdown-colors.md`) for the full design
 * history this pins down — Effort 1 of that plan.
 */
import { describe, expect, it } from "vitest";
import {
  buildSwatchStyleSheet,
  collectSwatchRegistry,
  createEmptySwatchRegistry,
  isSafeSwatchColorValue,
  parseOxDocument,
  parsePaletteAttrs,
  parseSwatchAttrs,
  resolveSwatchRole,
  slugifySwatchName,
  swatchVarName,
  type DirectiveNode,
  type SwatchRegistry,
} from "oxmarkdown-core";

function leafNode(name: string, attributes: Record<string, string> | null): DirectiveNode {
  return { type: "leafDirective", name, attributes, children: [] } as unknown as DirectiveNode;
}

describe("isSafeSwatchColorValue", () => {
  it("accepts var() references, hex colors, and rgb()/rgba()", () => {
    expect(isSafeSwatchColorValue("var(--cactus-100)")).toBe(true);
    expect(isSafeSwatchColorValue("var(--ox-color-dark-text)")).toBe(true);
    expect(isSafeSwatchColorValue("#fff")).toBe(true);
    expect(isSafeSwatchColorValue("#ffff")).toBe(true);
    expect(isSafeSwatchColorValue("#ffffff")).toBe(true);
    expect(isSafeSwatchColorValue("#ffffffff")).toBe(true);
    expect(isSafeSwatchColorValue("rgb(10, 20, 30)")).toBe(true);
    expect(isSafeSwatchColorValue("rgba(10, 20, 30, 0.5)")).toBe(true);
    expect(isSafeSwatchColorValue("rgba(10, 20, 30, 1)")).toBe(true);
  });

  it("rejects bare CSS named colors — deliberate, not an oversight (round 13)", () => {
    expect(isSafeSwatchColorValue("red")).toBe(false);
    expect(isSafeSwatchColorValue("transparent")).toBe(false);
    expect(isSafeSwatchColorValue("currentColor")).toBe(false);
  });

  it("rejects anything that could break out of a CSS declaration", () => {
    expect(isSafeSwatchColorValue("red; } body { display:none } .x{")).toBe(false);
    expect(isSafeSwatchColorValue("</style><script>alert(1)</script>")).toBe(false);
    expect(isSafeSwatchColorValue("var(--x, blue)")).toBe(false); // no fallback-argument support in v1
    expect(isSafeSwatchColorValue("#ggg")).toBe(false);
    expect(isSafeSwatchColorValue("")).toBe(false);
  });
});

describe("slugifySwatchName / swatchVarName", () => {
  it("lowercases and collapses non-alphanumeric runs to a single dash", () => {
    expect(slugifySwatchName("My Cool Color!")).toBe("my-cool-color");
    expect(slugifySwatchName("already-slug")).toBe("already-slug");
    expect(slugifySwatchName("UPPER CASE")).toBe("upper-case");
  });

  it("trims leading/trailing dashes produced by the collapse", () => {
    expect(slugifySwatchName("--leading--")).toBe("leading");
  });

  it("falls back to a literal 'x' for a name that slugifies to nothing", () => {
    expect(slugifySwatchName("###")).toBe("x");
    expect(slugifySwatchName("")).toBe("x");
  });

  it("builds the full custom-property name from role + slug", () => {
    expect(swatchVarName("surface", "My Cool Color!")).toBe("--ox-swatch-surface-my-cool-color");
    expect(swatchVarName("color", "mint")).toBe("--ox-swatch-color-mint");
  });
});

describe("parseSwatchAttrs", () => {
  it("parses a well-formed registration", () => {
    const node = leafNode("swatch", {
      role: "surface",
      name: "mint",
      light: "var(--cactus-100)",
      dark: "var(--cactus-800)",
    });
    expect(parseSwatchAttrs(node)).toEqual({
      role: "surface",
      name: "mint",
      light: "var(--cactus-100)",
      dark: "var(--cactus-800)",
    });
  });

  it("rejects a missing required attribute", () => {
    expect(parseSwatchAttrs(leafNode("swatch", { role: "surface", name: "mint", light: "#fff" }))).toBeNull();
    expect(parseSwatchAttrs(leafNode("swatch", { name: "mint", light: "#fff", dark: "#000" }))).toBeNull();
    expect(parseSwatchAttrs(leafNode("swatch", null))).toBeNull();
  });

  it("rejects an unrecognized role — the role set is fixed (round 5)", () => {
    expect(
      parseSwatchAttrs(leafNode("swatch", { role: "glow", name: "mint", light: "#fff", dark: "#000" })),
    ).toBeNull();
  });

  it("rejects a value that fails the safety grammar", () => {
    expect(
      parseSwatchAttrs(leafNode("swatch", { role: "surface", name: "mint", light: "red", dark: "#000" })),
    ).toBeNull();
    expect(
      parseSwatchAttrs(
        leafNode("swatch", {
          role: "surface",
          name: "mint",
          light: "red; } body { display:none } .x{",
          dark: "#000",
        }),
      ),
    ).toBeNull();
  });
});

describe("parsePaletteAttrs", () => {
  it("parses a composite with a subset of roles", () => {
    const node = leafNode("palette", { name: "crisp", surface: "farground", color: "mint" });
    expect(parsePaletteAttrs(node)).toEqual({ name: "crisp", surface: "farground", color: "mint" });
  });

  it("requires a name", () => {
    expect(parsePaletteAttrs(leafNode("palette", { surface: "farground" }))).toBeNull();
    expect(parsePaletteAttrs(leafNode("palette", null))).toBeNull();
  });

  it("tolerates a palette with no roles set at all", () => {
    expect(parsePaletteAttrs(leafNode("palette", { name: "empty" }))).toEqual({ name: "empty" });
  });
});

describe("collectSwatchRegistry", () => {
  it("collects top-level swatches/palettes, later registration wins, and ignores nested ones", () => {
    const doc = parseOxDocument(`
::swatch{role="surface" name="mint" light="var(--cactus-100)" dark="var(--cactus-800)"}
::swatch{role="color" name="mint" light="#fff" dark="#000"}
::palette{name="crisp" surface="mint" color="mint"}

:::section{surface="mint"}
::swatch{role="surface" name="nested" light="#111111" dark="#eeeeee"}
nested content
:::

::swatch{role="surface" name="mint" light="var(--cactus-200)" dark="var(--cactus-900)"}
`);
    const registry = collectSwatchRegistry(doc);

    // Later registration of the SAME (role, name) overwrites the earlier one.
    expect(registry.swatches.get("surface")?.get("mint")).toEqual({
      light: "var(--cactus-200)",
      dark: "var(--cactus-900)",
    });
    // A different role with the same name is an unrelated registration.
    expect(registry.swatches.get("color")?.get("mint")).toEqual({ light: "#fff", dark: "#000" });
    // Written inside a container directive's own body — never collected.
    expect(registry.swatches.get("surface")?.get("nested")).toBeUndefined();
    expect(registry.palettes.get("crisp")).toEqual({ name: "crisp", surface: "mint", color: "mint" });
  });

  it("returns an empty registry for a document with no swatches", () => {
    const doc = parseOxDocument("# Just a heading\n\nSome text.\n");
    const registry = collectSwatchRegistry(doc);
    expect(registry.swatches.get("surface")?.size).toBe(0);
    expect(registry.palettes.size).toBe(0);
  });
});

describe("resolveSwatchRole", () => {
  function fixtureRegistry(): SwatchRegistry {
    const registry = createEmptySwatchRegistry();
    registry.swatches.get("surface")!.set("mint", { light: "var(--cactus-100)", dark: "var(--cactus-800)" });
    registry.swatches.get("surface")!.set("alt", { light: "#111", dark: "#eee" });
    registry.palettes.set("crisp", { name: "crisp", surface: "mint" }); // no `color`/`border`/`shadow`
    return registry;
  }

  it("step 3: an explicit attribute wins outright when it resolves", () => {
    const registry = fixtureRegistry();
    expect(resolveSwatchRole({ role: "surface", registry, explicit: "mint" })).toBe("var(--ox-swatch-surface-mint)");
  });

  it("explicit beats palette even when both are given", () => {
    const registry = fixtureRegistry();
    expect(
      resolveSwatchRole({ role: "surface", registry, explicit: "alt", palette: "crisp" }),
    ).toBe("var(--ox-swatch-surface-alt)");
  });

  it("step 2: falls back to the palette's value when no explicit attribute is given", () => {
    const registry = fixtureRegistry();
    expect(resolveSwatchRole({ role: "surface", registry, palette: "crisp" })).toBe("var(--ox-swatch-surface-mint)");
  });

  it("step 1: falls back to the directive's own built-in default when nothing else resolves", () => {
    const registry = fixtureRegistry();
    expect(resolveSwatchRole({ role: "shadow", registry, fallback: "none" })).toBe("none");
    // `crisp` doesn't define `shadow` — falls through past the palette too.
    expect(resolveSwatchRole({ role: "shadow", registry, palette: "crisp", fallback: "none" })).toBe("none");
  });

  it("an unresolved name falls through SILENTLY — no visible marker (round 13)", () => {
    const registry = fixtureRegistry();
    expect(resolveSwatchRole({ role: "surface", registry, explicit: "does-not-exist", fallback: "transparent" })).toBe(
      "transparent",
    );
    expect(resolveSwatchRole({ role: "surface", registry, palette: "does-not-exist", fallback: "transparent" })).toBe(
      "transparent",
    );
  });

  it("returns undefined when nothing resolves and there's no fallback either", () => {
    const registry = fixtureRegistry();
    expect(resolveSwatchRole({ role: "shadow", registry })).toBeUndefined();
  });

  it("works with no registry at all — always falls straight through to fallback", () => {
    expect(resolveSwatchRole({ role: "surface", explicit: "mint", fallback: "transparent" })).toBe("transparent");
    expect(resolveSwatchRole({ role: "surface" })).toBeUndefined();
  });
});

describe("buildSwatchStyleSheet", () => {
  it("returns an empty string for an empty registry", () => {
    expect(buildSwatchStyleSheet(createEmptySwatchRegistry(), ".ox-swatch-scope-1")).toBe("");
  });

  it("emits a light rule plus a dark-media rule, scoped to the given selector", () => {
    const registry = createEmptySwatchRegistry();
    registry.swatches.get("surface")!.set("mint", { light: "var(--cactus-100)", dark: "var(--cactus-800)" });
    const css = buildSwatchStyleSheet(registry, ".ox-swatch-scope-1");
    expect(css).toBe(
      [
        ".ox-swatch-scope-1 { --ox-swatch-surface-mint: var(--cactus-100); }",
        "@media (prefers-color-scheme: dark) { .ox-swatch-scope-1 { --ox-swatch-surface-mint: var(--cactus-800); } }",
      ].join("\n"),
    );
  });

  it("defensively skips an entry that wouldn't pass the value grammar, even if it got into the registry some other way", () => {
    const registry = createEmptySwatchRegistry();
    registry.swatches.get("surface")!.set("mint", { light: "var(--cactus-100)", dark: "var(--cactus-800)" });
    // Bypasses `parseSwatchAttrs` on purpose, simulating a registry built by hand.
    registry.swatches.get("color")!.set("bad", { light: "red", dark: "red" });
    const css = buildSwatchStyleSheet(registry, ".scope");
    expect(css).not.toContain("--ox-swatch-color-bad");
    expect(css).toContain("--ox-swatch-surface-mint");
  });
});
