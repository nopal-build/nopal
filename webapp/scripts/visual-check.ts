// webapp/scripts/visual-check.ts
//
// Captures authenticated screenshots of one or more app routes in both
// light and dark mode, for an agent (or human) to review directly.
//
// Usage (from webapp/):
//   npx vite-node scripts/visual-check.ts [--email=someone@example.com] [path ...]
//
// Examples:
//   npx vite-node scripts/visual-check.ts
//     -> screenshots /fruits/styles (the living style guide) in light + dark
//   npx vite-node scripts/visual-check.ts /fruits/profile /fruits
//     -> screenshots both routes in light + dark
//
// Requires:
//   - `npm run dev` already running on http://localhost:3000 (this script
//     can't start it itself — it's a long-lived server).
//   - Playwright's Chromium installed once: `npx playwright install chromium`
//   - A reachable SurrealDB (same DATABASE_URL the app itself uses), since
//     this authenticates by looking up a real human record.
//
// How auth works: rather than driving the TOTP/passkey login UI (slow and
// hard to script), this builds a real `_auth` session cookie the exact same
// way `auth.server.ts` does (`sessionStorage.commitSession`) and injects it
// into the Playwright browser context before navigating. No test-only auth
// route is added to the app itself.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getHumans, getHumanByEmail, type Human } from "robustness-core/data/humans.server";
import { sessionStorage } from "../app/modules/auth/session.server";

const BASE_URL = process.env.VISUAL_CHECK_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = path.resolve(import.meta.dirname, "../tmp/visual-check");

async function resolveHuman(email?: string): Promise<Human> {
  if (email) {
    const human = await getHumanByEmail(email);
    if (!human) throw new Error(`No human found for email: ${email}`);
    return human;
  }

  // Default to an existing Super/Admin so gated nav items (All Projects,
  // Styles, the "..." management menu, etc.) are visible in the screenshot.
  const humans = (await getHumans())?.data ?? [];
  const chosen =
    humans.find((h) => h.role === "Super") ??
    humans.find((h) => h.role === "Admin");
  if (!chosen) {
    throw new Error(
      "No Super/Admin account found to authenticate as. Pass " +
        "--email=someone@example.com for an existing account.",
    );
  }
  return chosen;
}

async function buildAuthCookie(
  human: Human,
): Promise<{ name: string; value: string }> {
  const session = await sessionStorage.getSession();
  session.set("user", human);
  const setCookieHeader = await sessionStorage.commitSession(session);
  const [pair] = setCookieHeader.split(";");
  const eqIndex = pair.indexOf("=");
  return { name: pair.slice(0, eqIndex), value: pair.slice(eqIndex + 1) };
}

function slugify(routePath: string): string {
  return routePath.replace(/^\//, "").replace(/\//g, "-") || "root";
}

async function main() {
  const args = process.argv.slice(2);
  let email: string | undefined;
  const routePaths: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else routePaths.push(arg);
  }
  if (routePaths.length === 0) routePaths.push("/fruits/styles");

  try {
    await fetch(BASE_URL);
  } catch {
    throw new Error(
      `Could not reach ${BASE_URL} — make sure \`npm run dev\` is running first.`,
    );
  }

  const human = await resolveHuman(email);
  const cookie = await buildAuthCookie(human);

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);

  const saved: string[] = [];
  for (const routePath of routePaths) {
    const slug = slugify(routePath);
    for (const colorScheme of ["light", "dark"] as const) {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme });
      await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "networkidle" });
      const filePath = path.join(OUT_DIR, `${slug}--${colorScheme}.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      saved.push(filePath);
      await page.close();
    }
  }

  await browser.close();

  console.log(
    `\nAuthenticated as ${human.name} <${human.email}> (${human.role}).\n`,
  );
  console.log("Saved:");
  for (const filePath of saved) console.log(`  ${filePath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
