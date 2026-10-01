/**
 * `components/stamps-candidates/` holds components that may move into
 * `packages/stamps` (Austin, 2026-09-24). What makes a move a copy and not
 * a rewrite is that nothing in there knows about this app: no data
 * modules, no routes, no app components. This pins it.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../components/stamps-candidates");
const ALLOWED = [/^react$/, /^react-router$/, /^stamps\//, /^\.\/[\w.-]+$/];

describe("stamps candidates stay free of app code", () => {
  it("import only react, react-router, stamps and each other", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(DIR).filter((n) => /\.(ts|tsx)$/.test(n))) {
      const src = readFileSync(path.join(DIR, name), "utf8");
      for (const [, spec] of src.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
        if (!ALLOWED.some((re) => re.test(spec))) offenders.push(`${name}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("style only with stamps' variables, never a literal colour", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(DIR).filter((n) => n.endsWith(".css"))) {
      const src = readFileSync(path.join(DIR, name), "utf8").replace(/rgba\(0, 0, 0, [\d.]+\)/g, "");
      if (/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(src)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
