import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/playground.html");
  await page.locator(".playground-rendered").waitFor();
});

test("the starting sample renders every OxMarkdown-specific construct", async ({
  page,
}) => {
  const rendered = page.locator(".playground-rendered");
  await expect(rendered.locator(".ox-directive-leaf")).toHaveCount(1);
  await expect(rendered.locator(".ox-directive-container")).toHaveCount(1);
  await expect(rendered.locator(".ox-directive-text")).toHaveCount(1);
  await expect(rendered.locator("input.ox-checkbox")).toHaveCount(2);
  await expect(rendered.locator("mark")).toHaveCount(1);
  await expect(rendered.locator("s")).toHaveCount(1);
  // The starting sample's `::badge{label="Leaf directive"}` and
  // non-verbose `:ref{...}` get their real, specific renderings now
  // (see `convert.rs`'s `directive_content`), not the generic raw-
  // syntax fallback.
  await expect(rendered.locator(".ox-directive-badge")).toHaveText(
    "Leaf directive",
  );
  await expect(rendered.locator(".ox-directive-ref-glyph")).toHaveText("*");
});

test("editing the source live-updates the rendered output, isolated from the starting sample", async ({
  page,
}) => {
  const textarea = page.locator(".playground-source");
  const rendered = page.locator(".playground-rendered");

  await textarea.fill('::badge{label="hello"}\n');
  await expect(rendered.locator(".ox-directive-leaf")).toHaveText("hello");
  // Nothing left over from the starting sample.
  await expect(rendered.locator(".ox-directive-container")).toHaveCount(0);
  await expect(rendered.locator("input.ox-checkbox")).toHaveCount(0);

  await textarea.fill("A plain paragraph, nothing special.\n");
  await expect(rendered.locator("p")).toHaveText(
    "A plain paragraph, nothing special.",
  );
  await expect(rendered.locator(".ox-directive")).toHaveCount(0);
});

test("the rendered column reflects the SAME conversion pipeline as SSR/the main editor", async ({
  page,
}) => {
  // A regression check specifically for the two real DomSpec/schema
  // constraints found building the directive schema (see
  // `oxmarkdown_schema.rs`'s own doc comment): attributes preserved and
  // shown in the synthetic display label, and a container directive's
  // content genuinely converts (not a placeholder).
  const textarea = page.locator(".playground-source");
  const rendered = page.locator(".playground-rendered");

  await textarea.fill(':::note{title="x"}\nfirst\n\nsecond\n:::\n');
  const container = rendered.locator(".ox-directive-container");
  await expect(container).toHaveAttribute("data-directive-name", "note");
  await expect(container.locator("p")).toHaveCount(2);
  await expect(container.locator("p").nth(0)).toHaveText("first");
  await expect(container.locator("p").nth(1)).toHaveText("second");
});

test("a verbose :ref{...} renders fully spelled out with a real source link", async ({
  page,
}) => {
  const textarea = page.locator(".playground-source");
  const rendered = page.locator(".playground-rendered");

  await textarea.fill(
    'Decided on cedar :ref{name="Jane Doe" datetime="2026-08-17T14:30:00Z" location="/x" verbose="true"} today.\n',
  );
  const ref = rendered.locator(".ox-directive-ref-verbose");
  await expect(ref).toHaveText("Jane Doe \u00b7 Aug 17, 2026, 2:30 PM \u00b7 source");
  const link = ref.locator("a");
  await expect(link).toHaveText("source");
  await expect(link).toHaveAttribute("href", "/x");
});
