// app/routes/fruits_.styles_.oxmarkdown.tsx
//
// A dedicated, evolving page for OxMarkdown — reachable from the Design
// System page (`/fruits/styles`), not nested under it (this file's name
// breaks nesting at both `fruits_` and `styles_`, same convention as
// `fruits_.vault.tsx` breaking nesting under `fruits`).
//
// Two purposes, both maintained going forward as OxMarkdown grows:
//   1. A live playground — edit markdown, see it render, try theme
//      overrides — so decisions can be checked visually, not just by
//      reading code.
//   2. A running decision log — short, human-scannable entries on what
//      changed and why, a companion to the full technical detail in the
//      `oxmarkdown` skill (`.agents/skills/oxmarkdown/SKILL.md`).
//
// Convention for future edits: add a new `DECISIONS` entry (newest last)
// each time a build-plan step lands, and extend the "Try it" section with
// whatever the step actually added (a new directive example, an
// interactable demo, ...). Keep entries short — this page is for a quick
// visual reminder, not the full rationale (that's the skill file).
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import OxRenderer from "../components/OxRenderer";
import type { DirectiveRegistry } from "../oxmarkdown/directiveRegistry";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  return { user };
}

// ─── Helpers (mirrors fruits_.styles.tsx's Section/Label pattern) ────────────

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} style={{ marginBottom: "64px" }}>
      <h2
        className="font-bold text-lg font-mono mb-6 pb-2 purple-text"
        style={{ borderBottom: "1px solid var(--midground)" }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-mono mb-1 subtle-text">{children}</div>;
}

// ─── Decision log ─────────────────────────────────────────────────────────
// Newest last. Keep each entry to a couple of sentences — link to the
// oxmarkdown skill (mentioned once in the page header) for full detail.

const DECISIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Two modes, not three",
    body: (
      <>
        MdxEditor's View / Workable / Editable became <strong>Interacting</strong> and{" "}
        <strong>Editing</strong> — Editing is a strict superset of Interacting, not a
        separate thing. "Workable" was never really a third mode; it was Interacting
        with one specific interactable (tasks) enabled. Which interactables are
        enabled is a per-viewer permission, not a mode.
      </>
    ),
  },
  {
    title: "Interactables: select, then act",
    body: (
      <>
        Every non-plain-text element (a mention, a directive, a checkbox) is an{" "}
        <strong>interactable</strong>. Arrow-onto, click/tap, or a first Backspace
        always selects one as a whole unit first — never a bare caret inside it. A
        second Backspace reverts it to raw text (soft, reversible); Delete instead
        removes it outright (relies on undo). A range selection that happens to span
        an interactable treats it as one plain character — no special behavior there.
      </>
    ),
  },
  {
    title: "Generic directives replace the old `[key]` chip syntax",
    body: (
      <>
        <code>:name{"{"}attrs{"}"}</code> (inline), <code>::name{"{"}attrs{"}"}</code>{" "}
        (block), and <code>:::name{"{"}attrs{"}"} ... :::</code> (container) are the
        one extension mechanism for typed content — csv-key chips, project blocks
        (budget tables, galleries), and anything future all use the same syntax
        instead of one-off conventions.
      </>
    ),
  },
  {
    title: "Step 1: a real document model, not `\\n\\n`-split strings",
    body: (
      <>
        The old system split markdown into paragraphs by blank line, before anything
        knew directives existed — so a container directive could never wrap a blank
        line without breaking. Replaced with a real mdast parse (the same tree shape
        `remark`/`mdast-util-*` use), which nests real block content regardless of
        blank lines. Proved this by round-tripping a container directive with a blank
        line inside it — the exact case that broke before.
      </>
    ),
  },
  {
    title: "The core is framework-agnostic on purpose",
    body: (
      <>
        `oxmarkdown/document.ts` (parse/serialize) has no React import at all — it's
        plain data transformation. Not because a native app is imminent, but because
        keeping the model pure costs nothing now and keeps a future port (Rust, or
        anything else) a translation exercise instead of a redesign, if it's ever
        actually needed.
      </>
    ),
  },
  {
    title: "Its own themable stylesheet, not a `.nopal-content` port",
    body: (
      <>
        `.ox-content` reads every value from an `--ox-*` custom property — nopal's
        current palette is just this file's default, not something baked into the
        rules. Dark mode redefines the same variables in one block instead of
        duplicating every component's colors. A caller can override individual
        tokens (try the font field below) without touching the stylesheet at all.
      </>
    ),
  },
  {
    title: "Found (not yet fixed): extra blank lines between paragraphs are lost",
    body: (
      <>
        Confirmed by filling the textarea above with 1 vs. 3 blank lines between two
        paragraphs and checking the rendered layout: both produce identical output.
        Not a CSS issue — standard CommonMark parsing treats "1 blank line" and "5
        blank lines" as the same signal ("these are separate blocks") and discards
        the count before OxRenderer ever sees it. The old system special-cased this
        (an empty node per extra blank line); the mdast model needs the same trick,
        using each node's `position.start.line`/`end.line` to detect a gap bigger
        than the minimum and render spacer paragraphs for the difference. Not done
        yet — noted for a follow-up pass, not blocking step 2.
      </>
    ),
  },
  {
    title: "Found (and fixed): gutter markers need their own room",
    body: (
      <>
        The heading/bullet/list-number markers hang in a negative-offset margin —
        and `overflow-x: hidden` clips relative to an element's own box, not the
        viewport, so no amount of padding on a wrapper could ever give them room.
        `.ox-content` now reserves its own left padding (one grid cell) instead of
        depending on incidental space from wherever it's embedded. The old
        `.nopal-content` likely has this same latent bug, just masked by whatever
        page happens to wrap it.
      </>
    ),
  },
];

// ─── Sample content for the playground ─────────────────────────────────────

const DEFAULT_SAMPLE = `# Try editing this

Bold, *italic*, ~~strikethrough~~, inline \`code\`, and a [link](https://example.com).

:::note{title="Container directive"}
This paragraph is followed by a blank line inside the directive —

the exact case that broke the old regex-based system. It survives here.
:::

::badge{label="Leaf directive"}

::unregistered{demo="unknown directive fallback"}

- [ ] Unchecked task
- [x] Checked task
- Plain bullet

1. Ordered
2. List
`;

const DEMO_DIRECTIVES: DirectiveRegistry = {
  note: ({ attrs, children }) => (
    <div style={{ borderLeft: "3px solid var(--ox-color-accent)", paddingLeft: 12 }}>
      {attrs.title && <div className="ox-directive-title">{attrs.title}</div>}
      {children}
    </div>
  ),
  badge: ({ attrs }) => (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        background: "var(--ox-color-selected-bg)",
        border: "1px solid var(--ox-color-selected-border)",
      }}
    >
      {attrs.label}
    </span>
  ),
};

// ─── Main ───────────────────────────────────────────────────────────────────

export default function OxMarkdownStyles() {
  const [markdown, setMarkdown] = useState(DEFAULT_SAMPLE);
  const [fontFamily, setFontFamily] = useState("");
  const [colorAccent, setColorAccent] = useState("");

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "1000px" }}>
        {/* Page header */}
        <div className="mb-12">
          <Link
            to="/fruits/styles"
            className="text-xs subtle-text hover:opacity-80"
            style={{ textDecoration: "none" }}
          >
            ← Design System
          </Link>
          <h1 className="font-bold text-2xl mt-2 mb-2">OxMarkdown</h1>
          <p className="text-sm font-mono subtle-text">
            The planned successor to MdxEditor — this page is a live playground and
            running decision log, updated as each build step lands. Full technical
            detail lives in the <code>oxmarkdown</code> agent skill; this page is the
            quick, visual version.
          </p>
        </div>

        <Section id="status" title="Status">
          <p className="text-sm mb-2">
            <strong>Build plan step 1 done</strong> — real document model
            (<code>oxmarkdown/document.ts</code>) + themable renderer
            (<code>OxRenderer</code>, <code>oxmarkdown.css</code>). Step 2
            (interactables + Interacting-mode <code>OxEditor</code>) is next — this
            page is currently read-only/static, no selection or editing yet.
          </p>
        </Section>

        <Section id="try-it" title="Try it">
          <Label>Markdown source</Label>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            className="w-full text-sm font-mono p-3 rounded mb-6"
            style={{
              minHeight: "220px",
              background: "var(--midground)",
              color: "var(--purple)",
              border: "1px solid var(--foreground)",
            }}
          />

          <div className="flex flex-wrap gap-4 mb-6">
            <div style={{ minWidth: "220px" }}>
              <Label>Theme: font-family override</Label>
              <input
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                placeholder="e.g. ui-monospace, monospace"
                className="text-sm font-mono p-2 rounded w-full"
                style={{
                  background: "var(--midground)",
                  color: "var(--purple)",
                  border: "1px solid var(--foreground)",
                }}
              />
            </div>
            <div style={{ minWidth: "160px" }}>
              <Label>Theme: accent color override</Label>
              <input
                value={colorAccent}
                onChange={(e) => setColorAccent(e.target.value)}
                placeholder="e.g. #2f855a"
                className="text-sm font-mono p-2 rounded w-full"
                style={{
                  background: "var(--midground)",
                  color: "var(--purple)",
                  border: "1px solid var(--foreground)",
                }}
              />
            </div>
          </div>

          <Label>Rendered (OxRenderer)</Label>
          <div className="good-box p-4">
            <OxRenderer
              markdown={markdown}
              directives={DEMO_DIRECTIVES}
              theme={{
                fontFamily: fontFamily || undefined,
                colorAccent: colorAccent || undefined,
              }}
            />
          </div>
        </Section>

        <Section id="decisions" title="Decision log">
          <div className="flex flex-col gap-6">
            {DECISIONS.map((d, i) => (
              <div key={i}>
                <div className="font-bold text-sm mb-1">{d.title}</div>
                <p className="text-sm subtle-text">{d.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </AppLayout>
  );
}
