/**
 * AppLayout's nav finds the signed-in person in the page's loader data
 * (`useUser`, by a `user` key). A page that draws AppLayout and doesn't
 * return `user` loses the Maker tab for an Admin/Super: the Maker's
 * Scripts and GraphLog pages did, until 2026-10-05. The rest of the nav
 * (the home tab's label, the Vault, a Guide's Maker) comes from `navFor`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routes = path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes");

function loaderSource(src: string): string | null {
  const start = src.indexOf("export async function loader");
  if (start === -1) return null;
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end === -1 ? undefined : end);
}

const navPages = readdirSync(routes)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ f, src: readFileSync(path.join(routes, f), "utf8") }))
  .filter(({ src }) => src.includes("<AppLayout"))
  .map(({ f, src }) => ({ f, loader: loaderSource(src) ?? "" }));

describe("pages with the app nav", () => {
  it("return the user, so the nav knows who is signed in", () => {
    expect(navPages.filter(({ loader }) => !/^\s+user,|\buser:|\{ user[,} ]/m.test(loader)).map(({ f }) => f)).toEqual([]);
  });

  it("return the rest of the nav (navFor), so the tabs match every other page", () => {
    expect(navPages.filter(({ loader }) => !loader.includes("navFor(")).map(({ f }) => f)).toEqual([]);
  });
});
