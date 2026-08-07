// app/routes/fruits_.styles.tsx
import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, data } from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "../components/Badge";
import { Chip } from "../components/Chip";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import { CopyField } from "../components/CopyField";
import { SearchCollection } from "../components/SearchCollection";
import { MoreMenu, MoreIcon } from "../components/MoreMenu";
import { CircleButton } from "../components/CircleButton";
import { HamburgerNeqIcon } from "../components/HamburgerNeqIcon";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  return { user };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
        style={{
          borderBottom: "1px solid var(--midground)",
        }}
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

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="text-xs font-mono px-1.5 py-0.5 rounded"
      style={{
        background: "var(--midground)",
        color: "var(--purple)",
      }}
    >
      {children}
    </code>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-4 items-start">{children}</div>;
}

function Tile({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 items-start">{children}</div>;
}

// ─── Color Swatch ────────────────────────────────────────────────────────────

function Swatch({
  varName,
  hex,
  dark,
}: {
  varName: string;
  hex: string;
  dark?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5" style={{ width: "100px" }}>
      <div
        style={{
          width: "100%",
          height: "52px",
          background: `var(${varName})`,
          borderRadius: "4px",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
      />
      <div
        className="text-xs font-mono leading-tight"
        style={{ color: "var(--purple)" }}
      >
        {varName}
      </div>
      <div className="text-xs font-mono subtle-text">{hex}</div>
      {dark && (
        <div className="text-xs font-mono subtle-text" style={{ opacity: 0.6 }}>
          (dark mode)
        </div>
      )}
    </div>
  );
}

// ─── Hamburger → "≠" Icon ────────────────────────────────────────────────────

/** Self-contained demo of `HamburgerNeqIcon` (components/HamburgerNeqIcon.tsx)
 * — owns its own open/closed state so it can be dropped into the style
 * guide without wiring anything up. */
function HamburgerNeqDemo() {
  const [open, setOpen] = useState(false);
  return (
    <CircleButton
      aria-label={open ? "Collapse" : "Expand"}
      aria-pressed={open}
      active={open}
      onClick={() => setOpen((o) => !o)}
    >
      <HamburgerNeqIcon open={open} />
    </CircleButton>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const DEMO_FRUITS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

export default function FruitsStyles() {
  const [fruitQuery, setFruitQuery] = useState("");
  const filteredDemoFruits = fruitQuery
    ? DEMO_FRUITS.filter((f) =>
        f.toLowerCase().includes(fruitQuery.trim().toLowerCase()),
      )
    : DEMO_FRUITS;

  const [modalOpen, setModalOpen] = useState(false);

  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 py-12"
        style={{ maxWidth: "860px" }}
      >
        {/* Page header */}
        <div className="mb-12">
          <h1 className="font-bold text-2xl mb-2">Stamps</h1>
          <p className="text-sm font-mono subtle-text">
            Our design system — tokens, components, and patterns for the
            Fruits app.
          </p>
        </div>

        {/* ── Quick Nav ──────────────────────────────────────────────────── */}
        <div
          className="good-box p-4 mb-12 flex flex-wrap gap-x-5 gap-y-2"
          style={{ fontSize: "0.8rem" }}
        >
          {[
            ["#component-guide", "Component Guide"],
            ["#colors", "Colors"],
            ["#typography", "Typography"],
            ["#buttons", "Buttons"],
            ["#boxes", "Boxes & Cards"],
            ["#badges", "Badges & Chips"],
            ["#forms", "Form Inputs"],
            ["#links", "Links"],
            ["#spacing", "Spacing"],
            ["#editor", "Rich Text Editor"],
            ["#copy", "Copy Actions"],
            ["#collections", "Collections"],
            ["#overlays", "Overlays"],
            ["#menus", "Menus"],
            ["#icons", "Icons"],
            ["/fruits/styles/oxmarkdown", "OxMarkdown →"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="font-mono purple-light-text"
              style={{ textDecoration: "none" }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* ── 0. Component Decision Guide ────────────────────────────────── */}
        <Section id="component-guide" title="00 · Component Decision Guide">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              Read this before writing new markup — for humans and agents
              alike. Most UI needs in the Fruits app are already solved by
              something in <Code>app/components/</Code>. Reaching for a raw
              element or a hand-rolled pattern when a shared component
              already exists is a bug — replace it (see{" "}
              <Code>AGENTS.md</Code>).
            </p>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                &quot;I need to build…&quot; → use this
              </div>
              <div className="flex flex-col gap-2">
                {[
                  ["A text / textarea field", "<Input>", "components/Input.tsx"],
                  [
                    "A numeric field with +/− steppers",
                    "<NumberInput>",
                    "components/NumberInput.tsx",
                  ],
                  [
                    "A status pill (Complete, Overdue…)",
                    '<Badge variant="...">',
                    "components/Badge.tsx",
                  ],
                  [
                    "A filter / category tag",
                    "<Chip>",
                    "components/Chip.tsx",
                  ],
                  [
                    "A centered dialog / confirmation",
                    "<Modal>",
                    "components/Modal.tsx",
                  ],
                  [
                    "A round icon-only button (favorite, close, …)",
                    "<CircleButton>",
                    "components/CircleButton.tsx",
                  ],
                  [
                    'A "•••" (or any) action menu on a row/card',
                    "<MoreMenu>",
                    "components/MoreMenu.tsx",
                  ],
                  [
                    'Search a list, optionally "add new"',
                    "<SearchCollection>",
                    "components/SearchCollection.tsx",
                  ],
                  [
                    "A \u201ccopy this value\u201d row",
                    "<CopyField>",
                    "components/CopyField.tsx",
                  ],
                  [
                    "The page shell (nav, footer, container)",
                    "<AppLayout>",
                    "components/AppLayout.tsx",
                  ],
                ].map(([need, use, path]) => (
                  <div
                    key={need}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs font-mono"
                  >
                    <span className="shrink-0" style={{ minWidth: "260px" }}>
                      {need}
                    </span>
                    <span
                      className="shrink-0 purple-text"
                      style={{ minWidth: "210px", fontWeight: 600 }}
                    >
                      {use}
                    </span>
                    <span className="subtle-text">{path}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                When to extract a *new* component
              </div>
              <div className="flex flex-col gap-2.5 text-sm subtle-text">
                <div>
                  <span className="font-bold purple-text">
                    1. Used once, on one page
                  </span>{" "}
                  → keep it inline. Don&apos;t pre-abstract a pattern that
                  only exists in one place.
                </div>
                <div>
                  <span className="font-bold purple-text">
                    2. Repeated 2+ times inside one route file
                  </span>{" "}
                  → extract a local, unexported function component in that
                  same file (e.g. <Code>RelationshipCard</Code>,{" "}
                  <Code>WaiverCard</Code>, <Code>ApiTokenCard</Code> in{" "}
                  <Code>fruits_.profile.tsx</Code>). It doesn&apos;t need to
                  move to <Code>app/components/</Code> yet.
                </div>
                <div>
                  <span className="font-bold purple-text">
                    3. Needed on a second route, or it wraps a native form
                    element
                  </span>{" "}
                  → promote it to <Code>app/components/</Code>, and add a
                  live example to this page in the same change (see{" "}
                  <Code>#collections</Code> below for how{" "}
                  <Code>SearchCollection</Code> and <Code>CopyField</Code>{" "}
                  were pulled out of <Code>fruits_.profile.tsx</Code>).
                </div>
                <div>
                  <span className="font-bold purple-text">
                    4. Adding a prop/variant to an existing shared component
                  </span>{" "}
                  → update the component, then update its example here in
                  the same change. This page must stay accurate, or agents
                  will copy stale patterns from it.
                </div>
              </div>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Full component inventory — <Code>app/components/</Code>
              </div>
              <div className="flex flex-col gap-4">
                {[
                  {
                    group: "Layout & navigation",
                    rows: [
                      [
                        "AppLayout",
                        "Fruits app page shell — nav, footer, container. Wrap every Fruits route's default export in it.",
                      ],
                    ],
                  },
                  {
                    group: "Form & input",
                    rows: [
                      [
                        "Input",
                        "Text/textarea field with baked-in label, border, radius, padding. Use hideLabel for compact inline rows.",
                      ],
                      [
                        "NumberInput",
                        "Numeric field with +/− steppers, free-text editing, and inline math expressions (+ − × ÷ ^).",
                      ],
                    ],
                  },
                  {
                    group: "Status & tags",
                    rows: [
                      [
                        "Badge",
                        "Semantic status pill — neutral / success / warning / danger / accent variants.",
                      ],
                      [
                        "Chip",
                        "Neutral outline tag for categories/filters; supports an active state and onClick.",
                      ],
                    ],
                  },
                  {
                    group: "Collections & actions",
                    rows: [
                      [
                        "SearchCollection",
                        "Scrollable searchable list + footer search field, with a resultsSlot escape hatch for custom empty/grouped states.",
                      ],
                      [
                        "CopyField",
                        "Read-only field + Copy button for install commands, tokens, share links, etc.",
                      ],
                    ],
                  },
                  {
                    group: "Overlays & menus",
                    rows: [
                      [
                        "Modal",
                        "Dependency-free centered dialog — backdrop click / Escape to close.",
                      ],
                      [
                        "CircleButton",
                        "Round icon-only button — hover/focus/active states only, bring your own icon as children.",
                      ],
                      [
                        "MoreMenu",
                        "good-box action menu, open/outside-click/Escape handled for you. Defaults to a CircleButton + ••• trigger, but accepts a custom trigger render prop.",
                      ],
                    ],
                  },
                  {
                    group: "Rich text / MDX / Notion content",
                    rows: [
                      [
                        "MdxEditorClient",
                        "Lazy-loaded, browser-only rich text editor — see the Rich Text Editor section below.",
                      ],
                      [
                        "MdxEditorView / MdxEditorWorkable",
                        "Read-only and task-interactive markdown renderers sharing MdxRenderer.",
                      ],
                      [
                        "NotionText / NotionPageDetails",
                        "Render Notion API rich text/blocks for blog & content pages.",
                      ],
                    ],
                  },
                  {
                    group:
                      "Marketing / content-site components — different app section, not Fruits design-system atoms. Check before reusing here.",
                    rows: [
                      ["Layout", "Marketing site header/nav shell (not the Fruits app — use AppLayout there)."],
                      ["Breadcrumb", "Arrow + link trail used on marketing pages."],
                      ["Annotation", "Hand-drawn arrow callout for marketing copy."],
                      ["Carousel", "Generic swipeable slide carousel."],
                      ["FiveFactors / GbScore / GoodProgress / GoodAssets", "\"Good\" scorecard visualizations for marketing pages."],
                      ["AudioFormat", "\"Now available in audio format\" link for blog content."],
                      ["ZoomImg", "Click-to-zoom image viewer."],
                      ["Dropdown / TextDropdown", ":focus-within CSS dropdown — only used on grandpas-cabin-recipe.tsx, not the Fruits app."],
                    ],
                  },
                ].map(({ group, rows }) => (
                  <div key={group}>
                    <div className="text-xs font-mono font-bold subtle-text mb-2">
                      {group}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {rows.map(([name, desc]) => (
                        <div
                          key={name}
                          className="flex flex-wrap items-baseline gap-x-3 text-xs font-mono"
                        >
                          <span
                            className="purple-text shrink-0"
                            style={{ minWidth: "220px", fontWeight: 600 }}
                          >
                            {name}
                          </span>
                          <span className="subtle-text">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ── 1. Colors ──────────────────────────────────────────────────── */}
        <Section id="colors" title="01 · Colors">
          <div className="flex flex-col gap-8">
            <div>
              <p className="text-xs font-mono mb-4 subtle-text">
                Brand colors — defined in <Code>:root</Code> inside{" "}
                <Code>styles/root.css</Code>. Reference with{" "}
                <Code>var(--name)</Code> or{" "}
                <Code>style={"{{ color: 'var(--name)' }}"}</Code>.
              </p>
              <div className="flex flex-wrap gap-4 good-white-box p-4">
                <Swatch varName="--white" hex="#ffffff" />
                <Swatch varName="--purple" hex="#3f2b46" />
                <Swatch varName="--purple-light" hex="#7f5b8b" />
                <Swatch varName="--pink" hex="#d3a0e5" />
                <Swatch varName="--yellow" hex="#ffeaa4" />
                <Swatch varName="--yellow-light" hex="#fcf0c4" />
                <Swatch varName="--green" hex="#5da06d" />
                <Swatch varName="--green-light" hex="#86cb97" />
                <Swatch varName="--red" hex="#a63b31" />
                <Swatch varName="--red-light" hex="#f6c8c3" />
                <Swatch varName="--moon" hex="#c4c6fc" />
              </div>
            </div>

            <div>
              <div className="text-xs font-mono mb-4 font-bold purple-text">
                Surface / Background scale (light mode)
              </div>
              <div className="flex flex-wrap gap-4 good-white-box p-4">
                <Swatch varName="--farground" hex="#fff9f1" />
                <Swatch varName="--midground" hex="#ede4da" />
                <Swatch varName="--foreground" hex="#e5d6c5" />
              </div>
            </div>

            <div>
              <div className="text-xs font-mono mb-4 font-bold purple-text">
                Surface / Background scale (dark mode)
              </div>
              <div className="flex flex-wrap gap-4 good-white-box p-4">
                <Swatch varName="--dark-farground" hex="#494a72" dark />
                <Swatch varName="--dark-midground" hex="#6d6e99" dark />
                <Swatch varName="--dark-foreground" hex="#8d8eb4" dark />
              </div>
            </div>

            <div>
              <div className="text-xs font-mono mb-4 font-bold purple-text">
                Text
              </div>
              <div className="flex flex-wrap gap-4 good-white-box p-4">
                <Swatch varName="--text-subtle" hex="#817186" />
                <Swatch varName="--text-subtle-dark" hex="#c8b8ce" dark />
              </div>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Utility text color classes (prefer this over using color
                variables when applicable)
              </div>
              <div className="flex flex-wrap gap-4 text-sm font-mono">
                <span className="purple-text">.purple-text</span>
                <span className="purple-light-text">.purple-light-text</span>
                <span className="green-text">.green-text</span>
                <span className="green-light-text">.green-light-text</span>
                <span className="red-text">.red-text</span>
                <span className="red-light-text">.red-light-text</span>
                <span className="subtle-text">.subtle-text</span>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 2. Typography ──────────────────────────────────────────────── */}
        <Section id="typography" title="02 · Typography">
          <div className="flex flex-col gap-6">
            <div className="good-box p-5 flex flex-col gap-4">
              <Tile>
                <Label>text-2xl + font-bold — page titles</Label>
                <h1 className="font-bold text-2xl">Page Title</h1>
              </Tile>
              <Tile>
                <Label>text-xl + font-bold — section headings</Label>
                <h2 className="font-bold text-xl">Section Heading</h2>
              </Tile>
              <Tile>
                <Label>text-lg + font-bold — card headings</Label>
                <h3 className="font-bold text-lg">Card Heading</h3>
              </Tile>
              <Tile>
                <Label>text-base — body text</Label>
                <p>
                  The quick brown fox jumps over the lazy dog. Body text is the
                  default size and should be used for prose.
                </p>
              </Tile>
              <Tile>
                <Label>text-sm — secondary body, descriptions</Label>
                <p className="text-sm">
                  Smaller text used inside cards, meta information, and
                  supporting copy.
                </p>
              </Tile>
              <Tile>
                <Label>text-sm + subtle-text — muted / subdued</Label>
                <p className="text-sm subtle-text">
                  Muted text for secondary information, hints, and timestamps.
                </p>
              </Tile>
              <Tile>
                <Label>text-xs + font-mono — labels, badges, metadata</Label>
                <span className="text-xs font-mono">your role: Architect</span>
              </Tile>
              <Tile>
                <Label>font-mono — addresses, code, IDs</Label>
                <span className="font-mono text-sm">
                  123 Main St, Portland, OR
                </span>
              </Tile>
            </div>
          </div>
        </Section>

        {/* ── 3. Buttons ─────────────────────────────────────────────────── */}
        <Section id="buttons" title="03 · Buttons">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              All button classes extend the base <Code>.btn</Code> class (
              <Code>border-radius: 8px; display: inline-flex;</Code>) —
              except <Code>.btn-outline</Code>, which stands alone with a
              1px border and a tighter <Code>4px</Code> radius.
            </p>

            <Row>
              <Tile>
                <Label>.btn-primary — primary CTA, large padding</Label>
                <button className="btn-primary">Primary Action</button>
              </Tile>
              <Tile>
                <Label>.btn-purple — purple, no fixed padding</Label>
                <button className="btn-purple" style={{ padding: "8px 20px" }}>
                  Purple Button
                </button>
              </Tile>
              <Tile>
                <Label>.btn-secondary — green, medium padding</Label>
                <button className="btn-secondary">Secondary Action</button>
              </Tile>
              <Tile>
                <Label>.btn-yellow — soft warm tone, medium padding</Label>
                <button className="btn-yellow">Soft Action</button>
              </Tile>
              <Tile>
                <Label>.btn-outline — border + 4px radius, bring your own padding</Label>
                <button
                  className="btn-outline"
                  style={{ padding: "8px 16px" }}
                >
                  Outline
                </button>
              </Tile>
            </Row>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Sizes via padding (no separate size classes — add padding
                manually)
              </div>
              <Row>
                <Tile>
                  <Label>sm — px-3 py-1</Label>
                  <button
                    className="btn-purple"
                    style={{ padding: "4px 12px", fontSize: "0.75rem" }}
                  >
                    Small
                  </button>
                </Tile>
                <Tile>
                  <Label>md — px-4 py-2</Label>
                  <button
                    className="btn-purple"
                    style={{ padding: "8px 16px", fontSize: "0.875rem" }}
                  >
                    Medium
                  </button>
                </Tile>
                <Tile>
                  <Label>lg — px-8 py-4 (btn-primary default)</Label>
                  <button className="btn-primary">Large</button>
                </Tile>
              </Row>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Disabled state — add <Code>opacity-50 cursor-not-allowed</Code>
              </div>
              <Row>
                <button
                  className="btn-primary opacity-50 cursor-not-allowed"
                  disabled
                >
                  Disabled Primary
                </button>
                <button
                  className="btn-secondary opacity-50 cursor-not-allowed"
                  disabled
                >
                  Disabled Secondary
                </button>
              </Row>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Destructive / danger — use <Code>--red</Code> via custom CSS var
                override
              </div>
              <button
                style={{
                  background: "var(--red)",
                  color: "white",
                  padding: "8px 16px",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Delete Project
              </button>
            </div>
          </div>
        </Section>

        {/* ── 4. Boxes & Cards ───────────────────────────────────────────── */}
        <Section id="boxes" title="04 · Boxes & Cards">
          <div className="flex flex-col gap-6">
            <Row>
              <div style={{ flex: "1 1 260px" }}>
                <Label>.good-box — standard card / container</Label>
                <div className="good-box p-5 flex flex-col gap-2">
                  <div className="font-bold text-sm">Card Title</div>
                  <p className="text-sm subtle-text">
                    Use for any grouped content block. Background is{" "}
                    <Code>--farground</Code>, border is{" "}
                    <Code>--foreground</Code>.
                  </p>
                </div>
              </div>

              <div style={{ flex: "1 1 260px" }}>
                <Label>.good-box + .good-box-hover — interactive card</Label>
                <div className="good-box good-box-hover p-5 flex flex-col gap-2">
                  <div className="font-bold text-sm">Clickable Card</div>
                  <p className="text-sm subtle-text">
                    Hover to see border highlight and shadow. Wrap with a{" "}
                    <Code>{"<Link>"}</Code> or add <Code>onClick</Code>.
                  </p>
                </div>
              </div>

              <div style={{ flex: "1 1 260px" }}>
                <Label>.good-box-boarder — border only, no background</Label>
                <div className="good-box-boarder p-5 flex flex-col gap-2">
                  <div className="font-bold text-sm">Border Box</div>
                  <p className="text-sm subtle-text">
                    Transparent background. Good for nested sections.
                  </p>
                </div>
              </div>
            </Row>

            <div>
              <Label>
                Dividers inside .good-box — use{" "}
                <Code>
                  {
                    "<hr style={{ borderColor: 'currentColor', opacity: 0.12 }} />"
                  }
                </Code>
              </Label>
              <div className="good-box p-5 flex flex-col gap-3">
                <div className="font-bold text-sm">Section A</div>
                <hr
                  style={{
                    borderColor: "currentColor",
                    opacity: 0.12,
                    margin: "0 -4px",
                  }}
                />
                <div className="font-bold text-sm">Section B</div>
                <hr
                  style={{
                    borderColor: "currentColor",
                    opacity: 0.12,
                    margin: "0 -4px",
                  }}
                />
                <div className="font-bold text-sm">Section C</div>
              </div>
            </div>

            <div>
              <Label>
                Typical project card anatomy — header, badge, body, footer
              </Label>
              <div
                className="good-box flex flex-col gap-3 p-5"
                style={{ maxWidth: "420px" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-bold text-lg leading-tight">
                    Example Project
                  </h2>
                  <Chip>Residential</Chip>
                </div>
                <span className="text-xs font-mono purple-light-text">
                  your role: Architect
                </span>
                <p className="text-sm subtle-text">
                  A high-performance, healthy home designed for long-term
                  resilience.
                </p>
                <hr
                  style={{
                    borderColor: "currentColor",
                    opacity: 0.12,
                    margin: "0 -4px",
                  }}
                />
                <div className="flex gap-4 text-xs subtle-text">
                  <span>
                    <span className="font-bold purple-text">Start</span> Jan
                    2025
                  </span>
                  <span>→</span>
                  <span>
                    <span className="font-bold purple-text">Est. end</span> Dec
                    2025
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 5. Badges & Chips ──────────────────────────────────────────── */}
        <Section id="badges" title="05 · Badges & Chips">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              Use <Code>{"<Chip />"}</Code> for category / filter tags and{" "}
              <Code>{"<Badge variant='...' />"}</Code> for semantic status
              labels. Both live in <Code>components/</Code>.
            </p>

            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<Chip>"} — category tag, neutral outline style
              </div>
              <Row>
                <Tile>
                  <Label>default</Label>
                  <Chip>Residential</Chip>
                </Tile>
                <Tile>
                  <Label>active</Label>
                  <Chip active>Commercial</Chip>
                </Tile>
                <Tile>
                  <Label>interactive (onClick)</Label>
                  <Chip onClick={() => {}}>Toggle me</Chip>
                </Tile>
              </Row>
            </div>

            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<Badge variant='...'>"} — semantic status indicator
              </div>
              <Row>
                <Tile>
                  <Label>neutral (default)</Label>
                  <Badge>In Progress</Badge>
                </Tile>
                <Tile>
                  <Label>success</Label>
                  <Badge variant="success">Complete</Badge>
                </Tile>
                <Tile>
                  <Label>warning</Label>
                  <Badge variant="warning">Pending</Badge>
                </Tile>
                <Tile>
                  <Label>danger</Label>
                  <Badge variant="danger">Overdue</Badge>
                </Tile>
                <Tile>
                  <Label>accent</Label>
                  <Badge variant="accent">New</Badge>
                </Tile>
              </Row>
            </div>

            <div className="good-box p-4">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Label + value pattern — used in detail views
              </div>
              <div className="flex flex-col gap-2">
                {[
                  ["Budget", "$420,000 – $560,000"],
                  ["Address", "123 Main St, Portland, OR"],
                  ["Phase", "Design Development"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline gap-2">
                    <span
                      className="text-xs font-mono font-bold shrink-0 purple-text"
                      style={{ minWidth: "72px" }}
                    >
                      {label}
                    </span>
                    <span className="text-sm subtle-text">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* ── 6. Form Inputs ─────────────────────────────────────────────── */}
        <Section id="forms" title="06 · Form Inputs">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              Use the <Code>{"<Input>"}</Code> component from{" "}
              <Code>components/Input.tsx</Code> for text and textarea fields. It
              wraps native elements with a consistent label+field layout.
              Never reach for a raw <Code>{"<input>"}</Code> or{" "}
              <Code>{"<textarea>"}</Code> for a form field — use{" "}
              <Code>{"<Input>"}</Code> even for compact/inline rows (see the{" "}
              <Code>hideLabel</Code> example below).
            </p>
            <p className="text-xs font-mono subtle-text">
              Default field styling (border, radius, padding) is baked into{" "}
              <Code>{"<Input>"}</Code> automatically —{" "}
              <Code>border border-gray-300 rounded px-2 py-1</Code>. Any{" "}
              <Code>className</Code> you pass is appended, not replacing the
              default, so you only need it for one-off overrides.
            </p>
            <p className="text-xs font-mono subtle-text">
              <span className="font-bold">Gotcha:</span> when placing{" "}
              <Code>{"<Input>"}</Code> inside a flex row (e.g. side-by-side
              fields, or a field next to a button), add{" "}
              <Code>min-w-0</Code> to its flex-item wrapper. Flex children
              default to <Code>min-width: auto</Code>, and a field's
              intrinsic content width (a <Code>type="number"</Code> field's
              native spin buttons are the worst offender) can be wider than
              its flex-basis, overflowing the row instead of shrinking to
              fit — see the <Code>type="number"</Code> example below.
            </p>

            <div
              className="good-box p-5 flex flex-col gap-5"
              style={{ maxWidth: "480px" }}
            >
              <div>
                <Label>{"<Input label='...' name='...' />"} — text field</Label>
                <div className="flex flex-col">
                  <Input
                    label="Name"
                    type="text"
                    defaultValue=""
                    placeholder="e.g. Smith Residence"
                    name="demo-name"
                  />
                </div>
              </div>

              <div>
                <Input
                  label="Description"
                  type="textarea"
                  defaultValue=""
                  placeholder="Peaceful walk along a beach"
                  name="demo-description"
                />
              </div>

              <div>
                <Label>Native select — rounded + padding style</Label>
                <div className="flex flex-col">
                  <label className="text-sm" htmlFor="demo-type">
                    Project Type
                  </label>
                  <select
                    id="demo-type"
                    className="rounded"
                    style={{
                      padding: "8px",
                      border: "1px solid var(--foreground)",
                      background: "var(--farground)",
                      color: "var(--purple)",
                    }}
                  >
                    <option>Residential</option>
                    <option>Commercial</option>
                    <option>Renovation</option>
                  </select>
                </div>
              </div>

              <div>
                <Label>
                  {'<Input type="date" />'} — date field
                </Label>
                <div className="flex flex-col">
                  <Input
                    type="date"
                    label="Start Date"
                    name="demo-date"
                  />
                </div>
              </div>

              <div>
                <Label>
                  {'<Input type="number" />'} — inline form row, two fields
                  side by side
                </Label>
                <div className="flex gap-3">
                  {/* min-w-0 is required on flex children wrapping an
                      <Input> — flex items default to min-width:auto, and a
                      number field's intrinsic width (digits + the native
                      spin buttons) is wide enough to blow past its
                      flex-basis and overflow the row otherwise. */}
                  <div className="flex-1 min-w-0">
                    <Input
                      type="number"
                      label="Min ($)"
                      name="demo-min"
                      placeholder="0"
                      min={0}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Input
                      type="number"
                      label="Max ($)"
                      name="demo-max"
                      placeholder="0"
                      min={0}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label>
                  <Code>hideLabel</Code> — compact inline-edit row
                </Label>
                <p className="text-xs subtle-text mb-1">
                  Use this when a heading is already shown elsewhere on the
                  page (e.g. an "Edit" toggle next to a Save/Cancel button).
                  The label stays in the DOM for screen readers via{" "}
                  <Code>sr-only</Code>, it's just not shown visually.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Input
                      label="Name"
                      hideLabel
                      defaultValue="Smith Residence"
                      name="demo-hidden-label"
                    />
                  </div>
                  <button className="btn-secondary" type="button">
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 7. Links ───────────────────────────────────────────────────── */}
        <Section id="links" title="07 · Links">
          <div className="flex flex-col gap-4">
            <div className="good-box p-5 flex flex-col gap-4">
              <Tile>
                <Label>.link class — green underline on hover</Label>
                <a href="#links" className="link text-sm">
                  View project details
                </a>
              </Tile>

              <Tile>
                <Label>Back navigation — font-mono, purple-light</Label>
                <a
                  href="#links"
                  className="text-sm font-mono purple-light-text"
                  style={{
                    textDecoration: "none",
                  }}
                >
                  ← back to projects
                </a>
              </Tile>

              <Tile>
                <Label>
                  NavLink active state — font-bold, purple color, midground bg
                </Label>
                <div
                  style={{
                    fontSize: "0.875rem",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    fontWeight: 700,
                    color: "var(--purple)",
                    background: "var(--farground)",
                    display: "inline-block",
                  }}
                >
                  Dashboard (active)
                </div>
              </Tile>

              <Tile>
                <Label>NavLink default — text-subtle, transparent bg</Label>
                <div
                  className="purple-light-text"
                  style={{
                    fontSize: "0.875rem",
                    padding: "8px 12px",
                    borderRadius: "4px",
                    display: "inline-block",
                  }}
                >
                  All Projects
                </div>
              </Tile>
            </div>
          </div>
        </Section>

        {/* ── 8. Spacing ─────────────────────────────────────────────────── */}
        <Section id="spacing" title="08 · Spacing & Layout">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              Spacing uses Tailwind's default scale. Common values used across
              the Fruits app:
            </p>

            <div className="good-box p-5">
              <div className="flex flex-col gap-3">
                {[
                  ["gap-2 / p-2", "8px", "Icon spacing, tight rows"],
                  ["gap-3 / p-3", "12px", "Card internal sections"],
                  ["gap-4 / p-4", "16px", "Card padding (small)"],
                  ["gap-5 / p-5", "20px", "Card padding (standard)"],
                  ["gap-6 / p-6", "24px", "Card padding (large)"],
                  ["px-4 py-12", "16px / 48px", "Page outer padding"],
                  ["mb-8", "32px", "Section separation on page"],
                  ["mb-12", "48px", "Major section separation"],
                ].map(([cls, px, usage]) => (
                  <div
                    key={cls}
                    className="flex items-start gap-4 text-xs font-mono subtle-text"
                  >
                    <span
                      className="shrink-0 purple-text"
                      style={{
                        minWidth: "140px",
                        fontWeight: 600,
                      }}
                    >
                      {cls}
                    </span>
                    <span className="shrink-0" style={{ minWidth: "52px" }}>
                      {px}
                    </span>
                    <span>{usage}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="good-box p-5">
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Max widths
              </div>
              <div className="flex flex-col gap-2 text-xs font-mono subtle-text">
                <div>
                  <span className="purple-text" style={{ fontWeight: 600 }}>
                    maxWidth: 420px
                  </span>{" "}
                  — single-column cards (ProjectCard)
                </div>
                <div>
                  <span className="purple-text" style={{ fontWeight: 600 }}>
                    maxWidth: 480px
                  </span>{" "}
                  — forms and detail panels
                </div>
                <div>
                  <span className="purple-text" style={{ fontWeight: 600 }}>
                    maxWidth: 640px
                  </span>{" "}
                  — detail page content area
                </div>
                <div>
                  <span className="purple-text" style={{ fontWeight: 600 }}>
                    maxWidth: 860px
                  </span>{" "}
                  — wide content, admin views
                </div>
                <div>
                  <span className="purple-text" style={{ fontWeight: 600 }}>
                    container mx-auto px-4
                  </span>{" "}
                  — standard page wrapper (always use)
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 9. Rich Text Editor ────────────────────────────────────────── */}
        <Section id="editor" title="09 · Rich Text Editor">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              The rich-text editor is powered by <Code>@mdxeditor/editor</Code>.
              Its default slate/blue palette is overridden in{" "}
              <Code>styles/mdxeditor.css</Code> to use the Fruits design-system
              tokens. Use the lazy-loaded <Code>{"<MdxEditorClient>"}</Code>{" "}
              component — never import the editor directly (it is browser-only).
            </p>

            {/* Wrapper anatomy */}
            <div>
              <Label>
                Editor wrapper — outer container applied in the page
              </Label>
              <div
                className="good-box p-4 flex flex-col gap-3"
                style={{ maxWidth: "560px" }}
              >
                <div className="text-xs font-mono font-bold purple-text mb-1">
                  Wrapper div (applied around {"<MdxEditorClient>"})
                </div>
                <div
                  className="rounded-lg overflow-hidden text-xs font-mono subtle-text"
                  style={{
                    border: "1px solid var(--midground)",
                    background: "var(--farground)",
                  }}
                >
                  {/* Toolbar mock */}
                  <div
                    className="flex items-center gap-2 px-3"
                    style={{
                      borderBottom: "1px solid var(--midground)",
                      background: "var(--midground)",
                      padding: "6px 10px",
                      minHeight: "38px",
                    }}
                  >
                    {["B", "I", "U"].map((t) => (
                      <span
                        key={t}
                        className="font-bold"
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "var(--foreground)",
                          color: "var(--purple)",
                          fontSize: "0.75rem",
                          cursor: "default",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                    <span
                      style={{
                        width: "1px",
                        height: "16px",
                        background: "var(--foreground)",
                        margin: "0 4px",
                      }}
                    />
                    <span
                      className="text-xs subtle-text"
                      style={{ fontFamily: "monospace" }}
                    >
                      Paragraph ▾
                    </span>
                  </div>
                  {/* Content mock */}
                  <div
                    style={{
                      padding: "20px 24px",
                      minHeight: "80px",
                      color: "var(--purple)",
                      fontSize: "0.9375rem",
                      lineHeight: 1.7,
                    }}
                  >
                    <span className="font-bold">Heading</span>
                    <br />
                    <span
                      className="subtle-text"
                      style={{ fontSize: "0.875rem" }}
                    >
                      Body text flows here with comfortable line-height…
                    </span>
                  </div>
                </div>
                <div className="text-xs font-mono subtle-text mt-1">
                  <Code>border: 1px solid var(--midground)</Code> ·{" "}
                  <Code>background: var(--farground)</Code> ·{" "}
                  <Code>rounded-lg overflow-hidden</Code>
                </div>
              </div>
            </div>

            {/* CSS variable overrides */}
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                CSS variable overrides — <Code>styles/mdxeditor.css</Code>
              </div>
              <div className="good-box p-5 flex flex-col gap-4">
                <div>
                  <div className="text-xs font-mono font-bold subtle-text mb-2">
                    Base surfaces
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      [
                        "--basePageBg",
                        "var(--farground)",
                        "#fff9f1 — editor content area",
                      ],
                      [
                        "--baseBg",
                        "var(--midground)",
                        "#ede4da — toolbar background",
                      ],
                      [
                        "--baseBgHover",
                        "var(--foreground)",
                        "#e5d6c5 — hover tint",
                      ],
                      [
                        "--baseBorder",
                        "var(--midground)",
                        "#ede4da — control borders",
                      ],
                      [
                        "--baseTextContrast",
                        "var(--purple)",
                        "#3f2b46 — primary text",
                      ],
                      [
                        "--baseText",
                        "var(--text-subtle)",
                        "#817186 — icon / secondary text",
                      ],
                    ].map(([token, value, note]) => (
                      <div
                        key={token}
                        className="flex items-baseline gap-3 text-xs font-mono"
                      >
                        <span
                          className="purple-text shrink-0"
                          style={{ minWidth: "180px" }}
                        >
                          {token}
                        </span>
                        <span
                          className="shrink-0 purple-light-text"
                          style={{ minWidth: "160px" }}
                        >
                          {value}
                        </span>
                        <span className="subtle-text">{note}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <hr style={{ borderColor: "currentColor", opacity: 0.1 }} />

                <div>
                  <div className="text-xs font-mono font-bold subtle-text mb-2">
                    Accent — purple / moon palette (selections, active buttons)
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {[
                      [
                        "--accentBg",
                        "var(--moon)",
                        "#c4c6fc — selection highlight",
                      ],
                      [
                        "--accentSolid",
                        "var(--purple)",
                        "#3f2b46 — active pill bg",
                      ],
                      [
                        "--accentTextContrast",
                        "var(--farground)",
                        "#fff9f1 — text on solid",
                      ],
                      [
                        "--accentText",
                        "var(--purple-light)",
                        "#7f5b8b — accent text",
                      ],
                      [
                        "--accentBorder",
                        "var(--purple-light)",
                        "#7f5b8b — focus ring",
                      ],
                    ].map(([token, value, note]) => (
                      <div
                        key={token}
                        className="flex items-baseline gap-3 text-xs font-mono"
                      >
                        <span
                          className="purple-text shrink-0"
                          style={{ minWidth: "180px" }}
                        >
                          {token}
                        </span>
                        <span
                          className="shrink-0 purple-light-text"
                          style={{ minWidth: "160px" }}
                        >
                          {value}
                        </span>
                        <span className="subtle-text">{note}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Content element styles */}
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                Content element styles (scoped to <Code>.mdxeditor</Code>)
              </div>
              <div className="good-box p-5 flex flex-col gap-3">
                {[
                  ["font-size", "0.9375rem (15px) — body text in editor"],
                  ["line-height", "1.7 — comfortable reading"],
                  ["padding", "20px 24px — content area inset"],
                  ["min-height", "260px — minimum editor height"],
                  ["h1", "1.5rem · font-weight 700 · var(--purple)"],
                  ["h2 / h3", "1.2rem / 1.05rem · var(--purple-light)"],
                  [
                    "blockquote",
                    "3px left border · var(--purple-light) · italic",
                  ],
                  [
                    "code",
                    "var(--midground) bg · var(--purple) text · 3px radius",
                  ],
                  ["a", "var(--purple-light) · underline with offset"],
                  ["hr", "1px solid var(--midground)"],
                ].map(([prop, desc]) => (
                  <div
                    key={prop}
                    className="flex items-baseline gap-3 text-xs font-mono"
                  >
                    <span
                      className="purple-text font-bold shrink-0"
                      style={{ minWidth: "120px" }}
                    >
                      {prop}
                    </span>
                    <span className="subtle-text">{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Usage snippet */}
            <div>
              <Label>Usage in a page (admin-only, client-only)</Label>
              <div
                className="good-box p-4 text-xs font-mono code-block"
                style={{ lineHeight: 1.7 }}
              >
                <div>
                  <span className="subtle-text">
                    {"// lazy import at the top of the route"}
                  </span>
                </div>
                <div>
                  <span className="purple-text">{"const "}</span>
                  {"MdxEditorClient = "}
                  <span className="purple-text">{"lazy"}</span>
                  {"(() => "}
                  <span className="purple-text">{"import"}</span>
                  {'("../components/MdxEditorClient"));'}
                </div>
                <div className="mt-3 subtle-text">
                  {"// in the render tree"}
                </div>
                <div>{"<Suspense fallback={<div>Loading editor…</div>}>"}</div>
                <div style={{ paddingLeft: "16px" }}>
                  {'<div className="rounded-lg overflow-hidden"'}
                </div>
                <div style={{ paddingLeft: "32px" }}>
                  {'style={{ border: "1px solid var(--midground)",'}
                </div>
                <div style={{ paddingLeft: "48px" }}>
                  {'background: "var(--farground)" }}>'}
                </div>
                <div style={{ paddingLeft: "32px" }}>
                  {"<MdxEditorClient markdown={md} onChange={setMd} />"}
                </div>
                <div style={{ paddingLeft: "16px" }}>{"</div>"}</div>
                <div>{"</Suspense>"}</div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 10. Copy Actions ────────────────────────────────── */}
        <Section id="copy" title="10 · Copy Actions">
          <div className="flex flex-col gap-8">
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<CopyField>"} — read-only value + Copy button
              </div>
              <p className="text-xs subtle-text mb-3">
                Pulled out of <Code>fruits_.profile.tsx</Code> per the
                pattern in <Code>#component-guide</Code> above. Use for
                install commands, API keys, share links — anything
                the user needs to copy verbatim. It degrades gracefully:
                the field is <Code>readOnly</Code> and auto-selects on
                focus/click, so copying by hand still works if{" "}
                <Code>navigator.clipboard</Code> is unavailable.
              </p>
              <div className="good-box p-4" style={{ maxWidth: "480px" }}>
                <CopyField
                  value="nopal login --device=cli"
                  ariaLabel="example CLI command"
                />
              </div>
              <div className="good-box p-3 mt-3 text-xs font-mono code-block">
                {'<CopyField value={COMMAND} ariaLabel="..." />'}
              </div>
            </div>
          </div>
        </Section>

        {/* ── 11. Collections ─────────────────────────────────── */}
        <Section id="collections" title="11 · Collections">
          <div className="flex flex-col gap-8">
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<SearchCollection>"} — searchable, scrollable list + footer
                search field
              </div>
              <p className="text-xs subtle-text mb-3">
                Pulled out of <Code>fruits_.profile.tsx</Code> per the
                pattern in <Code>#component-guide</Code> above.{" "}
                A <Code>good-box</Code> shell for "search/filter a list, and
                optionally add a new entry" UI: fixed-height scrollable list
                on top, divider, search field below. It owns layout only —
                filtering and submission stay with the caller. Try typing a
                fruit name (or something that doesn't match) below:
              </p>
              <div style={{ maxWidth: "420px" }}>
                <SearchCollection
                  items={filteredDemoFruits}
                  getKey={(fruit) => fruit}
                  renderItem={(fruit) => (
                    <div className="good-box p-3 text-sm">{fruit}</div>
                  )}
                  emptyState={
                    <div
                      className="good-box p-3 text-sm"
                      style={{ opacity: 0.6 }}
                    >
                      No fruits match "{fruitQuery}".
                    </div>
                  }
                  searchInputProps={{
                    label: "Fruit",
                    hideLabel: true,
                    name: "fruit-demo-search",
                    value: fruitQuery,
                    onChange: (e) => setFruitQuery(e.target.value),
                    placeholder: "Search fruits…",
                  }}
                  height={160}
                />
              </div>
              <p className="text-xs subtle-text mt-3">
                For anything fancier than a plain filtered list — custom
                empty states, grouped sections (e.g. active vs. revoked), or
                a "+ Add {"{query}"}" affordance — pass{" "}
                <Code>resultsSlot</Code> instead of{" "}
                <Code>items</Code>/<Code>renderItem</Code> to take over the
                whole list area. See the Relationships list in{" "}
                <Code>fruits_.profile.tsx</Code> for the full example: it
                wraps <Code>{"<SearchCollection>"}</Code> in a{" "}
                <Code>{"<Form>"}</Code> so the search field doubles as an
                "add/invite by email" field.
              </p>
              <div
                className="rounded p-3 text-xs font-mono"
                style={{
                  background: "var(--yellow)",
                  color: "var(--purple)",
                }}
              >
                <span className="font-bold">Note:</span> the scrollable list
                area is a <Code>.collection-well</Code> — it matches the
                page background (white / <Code>--purple</Code>), so rows
                inside should just be <Code>.good-box</Code> cards (as
                above, and <Code>RelationshipCard</Code> in{" "}
                <Code>fruits_.profile.tsx</Code>). Don't force{" "}
                <Code>var(--white)</Code> backgrounds with explicit text
                colors — plain good-box rows flip for dark mode on their
                own, and so does everything inside them (
                <Code>MoreMenu</Code>, <Code>Badge</Code>,{" "}
                <Code>subtle-text</Code>, …).
              </div>
            </div>
          </div>
        </Section>

        {/* ── 11. Overlays & Menus ───────────────────────────────────────── */}
        {/* ── 12. Overlays ───────────────────────────────────── */}
        <Section id="overlays" title="12 · Overlays">
          <div className="flex flex-col gap-8">
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<Modal>"} — centered dialog
              </div>
              <p className="text-xs subtle-text mb-3">
                Dependency-free centered dialog — backdrop and{" "}
                <Code>Escape</Code> both close it. Use it for confirmations
                and short forms (e.g. the "Switch account" flow in{" "}
                <Code>fruits_.profile.tsx</Code>), not for full-page content.
              </p>
              <div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModalOpen(true)}
                >
                  Open example modal
                </button>
                <Modal
                  open={modalOpen}
                  onClose={() => setModalOpen(false)}
                  title="Example modal"
                >
                  <p className="text-sm subtle-text mb-4">
                    Modal content goes here — forms, confirmations, short
                    messages. Keep it under ~400px wide; for anything larger,
                    use a dedicated page or panel instead.
                  </p>
                  <div className="text-right">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setModalOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </Modal>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 13. Menus ──────────────────────────────────────── */}
        <Section id="menus" title="13 · Menus">
          <div className="flex flex-col gap-8">
            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<CircleButton>"} — round icon-only button
              </div>
              <p className="text-xs subtle-text mb-3">
                Just the circular hit area + hover/focus/
                <Code>active</Code> states — no menu, no assumptions about
                what's inside. Pass any icon as children (an SVG, an emoji,
                whatever). <Code>MoreMenu</Code> below uses this as its
                default trigger, but it stands on its own for any
                icon-only action (favorite, close, expand, …).
              </p>
              <Row>
                <Tile>
                  <Label>Default</Label>
                  <CircleButton aria-label="More actions">
                    <MoreIcon />
                  </CircleButton>
                </Tile>
                <Tile>
                  <Label>active (e.g. its menu is open)</Label>
                  <CircleButton aria-label="More actions" active>
                    <MoreIcon />
                  </CircleButton>
                </Tile>
                <Tile>
                  <Label>disabled</Label>
                  <CircleButton aria-label="More actions" disabled>
                    <MoreIcon />
                  </CircleButton>
                </Tile>
                <Tile>
                  <Label>Any SVG works — not just MoreIcon</Label>
                  <CircleButton aria-label="Add item">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </CircleButton>
                </Tile>
              </Row>
            </div>

            <div>
              <div className="text-xs font-mono mb-3 font-bold purple-text">
                {"<MoreMenu>"} — action menu, decoupled from its trigger
              </div>
              <p className="text-xs subtle-text mb-3">
                Owns open state, outside-click, and <Code>Escape</Code>{" "}
                handling — pass <Code>items</Code> and you're done. Defaults
                to a <Code>{"<CircleButton>"}</Code> with an oversized,
                SVG-drawn "•••" (not the typed <Code>…</Code> character —
                that renders too small and too tight to feel tappable), but
                the trigger is just a default: pass your own{" "}
                <Code>trigger</Code> render prop to open the same menu from
                a <Code>btn-primary</Code>, <Code>btn-outline</Code>, or
                anything else. This replaces the hand-rolled per-row "…"
                menu in <Code>RelationshipCard</Code> (
                <Code>fruits_.profile.tsx</Code>).
              </p>

              <Label>Default trigger (CircleButton + MoreIcon)</Label>
              <div className="good-box p-4 mb-4" style={{ maxWidth: "480px" }}>
                <MoreMenu
                  label="More actions"
                  items={[
                    { label: "Edit", onClick: () => {} },
                    { label: "Duplicate", onClick: () => {} },
                    { label: "Archive", onClick: () => {} },
                    { label: "Delete", onClick: () => {}, danger: true },
                  ]}
                />
              </div>

              <Label>In context — as a row's trailing action</Label>
              <div
                className="good-box p-3 flex items-center justify-between gap-4 mb-4"
                style={{ maxWidth: "480px" }}
              >
                <div className="text-sm min-w-0">
                  <div className="font-bold truncate">Smith Residence</div>
                  <div className="truncate subtle-text">
                    123 Main St, Portland, OR
                  </div>
                </div>
                <MoreMenu
                  label="Manage Smith Residence"
                  items={[
                    { label: "Edit details", onClick: () => {} },
                    { label: "Share with team", onClick: () => {} },
                    { label: "Archive project", onClick: () => {}, danger: true },
                  ]}
                />
              </div>

              <Label>
                Custom trigger — same menu, a <Code>btn-outline</Code> button
                instead
              </Label>
              <div className="good-box p-4 mb-4" style={{ maxWidth: "480px" }}>
                <MoreMenu
                  label="Manage project"
                  items={[
                    { label: "Edit details", onClick: () => {} },
                    { label: "Share with team", onClick: () => {} },
                    { label: "Archive project", onClick: () => {}, danger: true },
                  ]}
                  trigger={({ toggle, open, label }) => (
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ padding: "8px 16px" }}
                      aria-label={label}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={toggle}
                    >
                      Actions
                    </button>
                  )}
                />
              </div>

              <div
                className="good-box p-3 text-xs font-mono code-block"
                style={{ lineHeight: 1.7 }}
              >
                <div>{'<MoreMenu'}</div>
                <div style={{ paddingLeft: "16px" }}>
                  {'label="Manage project"'}
                </div>
                <div style={{ paddingLeft: "16px" }}>{"items={[...]}"}</div>
                <div style={{ paddingLeft: "16px" }}>
                  {"trigger={({ toggle, open, label }) => ("}
                </div>
                <div style={{ paddingLeft: "32px" }}>
                  {'<button className="btn-outline" aria-label={label}'}
                </div>
                <div style={{ paddingLeft: "48px" }}>
                  {'aria-haspopup="menu" aria-expanded={open} onClick={toggle}>'}
                </div>
                <div style={{ paddingLeft: "48px" }}>{"Actions"}</div>
                <div style={{ paddingLeft: "32px" }}>{"</button>"}</div>
                <div style={{ paddingLeft: "16px" }}>{")}"}</div>
                <div>{"/>"}</div>
              </div>
            </div>
          </div>
        </Section>

        {/* ── 14. Icons ──────────────────────────────────────────── */}
        <Section id="icons" title="14 · Icons">
          <div className="flex flex-col gap-6">
            <p className="text-xs font-mono subtle-text">
              A hamburger icon that morphs into a "≠"-style mark. The top
              and bottom lines slide 3px toward the center (they read as
              the two bars of "="), and the middle line rotates -55° on
              click — clicking again reverses both. Built from three plain{" "}
              <Code>div</Code> lines (not an SVG) so each line's{" "}
              <Code>transform</Code> can be transitioned independently.
            </p>

            <Row>
              <Tile>
                <Label>Click to toggle</Label>
                <HamburgerNeqDemo />
              </Tile>
            </Row>

            <div
              className="good-box p-3 text-xs font-mono code-block"
              style={{ lineHeight: 1.7 }}
            >
              <div>{"const [open, setOpen] = useState(false);"}</div>
              <div>{"<CircleButton"}</div>
              <div style={{ paddingLeft: "16px" }}>
                {"active={open}"}
              </div>
              <div style={{ paddingLeft: "16px" }}>
                {"onClick={() => setOpen((o) => !o)}"}
              </div>
              <div>{">"}</div>
              <div style={{ paddingLeft: "16px" }}>
                {"<HamburgerNeqIcon open={open} />"}
              </div>
              <div>{"</CircleButton>"}</div>
            </div>
          </div>
        </Section>
      </div>
    </AppLayout>
  );
}
