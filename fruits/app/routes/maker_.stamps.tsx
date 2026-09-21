// app/routes/maker_.stamps.tsx
// Stamps design-system guide, take two — lives under /maker (Admin/Super
// only, same gate as the rest of the Maker section) as a clean-slate
// rebuild of styles.tsx's Component Decision Guide. Built entirely with
// `stamps` primitives (sprinkles/textSize/tokens/CenterContent/
// DrawerContent/Stack/Cluster/Grid/…), no Tailwind — see AGENTS.md's "UI
// conventions" section for why. `/styles` remains the source of truth for
// everything not yet migrated here; sections below that haven't been
// rebuilt yet just link back to their matching anchor there (see
// `StubSection`).
//
// Also doubles as the live reference for the two `AppLayout` content-area
// types: this whole page is a `DrawerContent` (see `#layout` for the
// other type, `CenterContent`, which the main content column below uses)
// with the category nav living in the drawer instead of a horizontal bar
// up top.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  data,
  redirect,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { useSchemePref } from "../hooks/useSchemePref";
import { Surface } from "stamps/Surface";
import { ErrorPanel } from "stamps/ErrorPanel";
import { CenterContent } from "stamps/CenterContent";
import { DrawerContent } from "stamps/DrawerContent";
import { Chip } from "stamps/Chip";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Grid } from "stamps/Grid";
import { link } from "stamps/link.css";
import { textSize, truncate } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";

async function requireMakerAccess(request: Request) {
  const user = await getUser(request);
  if (!user) throw redirect("/login");
  if (user.role !== "Admin" && user.role !== "Super") {
    throw data("Forbidden", { status: 403 });
  }
  return user;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireMakerAccess(request);
  return null;
}

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <AppLayout>
        <CenterContent maxWidth={480}>
          <ErrorPanel
            status={403}
            title="Access Denied"
            message="The Stamps guide is only available to Admin and Super accounts."
            action={
              <Link to="/maker" className={`${link} ${textSize.sm}`}>
                ← Back to Maker
              </Link>
            }
          />
        </CenterContent>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <CenterContent maxWidth={480}>
        <ErrorPanel
          title="Something went wrong"
          message={
            isRouteErrorResponse(error)
              ? `${error.status} — ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "An unexpected error occurred."
          }
          action={
            <Link to="/maker" className={`${link} ${textSize.sm}`}>
              ← Back to Maker
            </Link>
          }
        />
      </CenterContent>
    </AppLayout>
  );
}

// ─── Small text helpers ───────────────────────────────────────────────────

const groupLabelClass = `${textSize.xs} ${sprinkles({
  fontWeight: "bold",
  fontFamily: "mono",
  textTransform: "uppercase",
  letterSpacing: "wide",
})}`;

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      className={`${textSize.xs} ${sprinkles({ fontFamily: "mono", px: 1.5, py: 0.5 })}`}
      style={{
        background: semanticColors.surfaceInset,
        color: semanticColors.textBrand,
        borderRadius: "4px",
      }}
    >
      {children}
    </code>
  );
}

function SectionHeading({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div
      className={sprinkles({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 3,
        mb: 6,
        pb: 2,
      })}
      style={{ borderBottom: `1px solid ${semanticColors.surfaceBorder}` }}
    >
      <h2
        className={`${textSize.lg} ${sprinkles({ fontWeight: "bold", fontFamily: "mono" })}`}
        style={{ color: semanticColors.textBrand, margin: 0 }}
      >
        {children}
      </h2>
      {actions}
    </div>
  );
}

function Section({
  id,
  title,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** Rendered on the right side of the heading row, e.g. a view-mode
   * toggle — see `ColorsSection`'s `FormatToggle`. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={sprinkles({ mb: 16 })}>
      <SectionHeading actions={actions}>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** Placeholder for a category that hasn't been rebuilt on this page yet —
 * links back to the matching anchor on the classic `/styles` guide, which
 * stays the source of truth until each section gets its own migration
 * pass. */
function StubSection({ id, title }: { id: string; title: string }) {
  return (
    <Section id={id} title={title}>
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        Not migrated to this page yet —{" "}
        <a href={`/styles#${id}`} className={link}>
          see the classic guide →
        </a>
      </p>
    </Section>
  );
}

// ─── Category nav (lives in the drawer) ──────────────────────────────────────

type NavSection = { id: string; label: string };
type NavCategory = { label: string; sections: NavSection[] };

const NAV: NavCategory[] = [
  { label: "Guide", sections: [{ id: "component-guide", label: "Component Guide" }] },
  {
    label: "Foundations",
    sections: [
      { id: "colors", label: "Colors" },
      { id: "typography", label: "Typography" },
      { id: "spacing", label: "Spacing" },
      { id: "icons", label: "Icons" },
    ],
  },
  { label: "Layout", sections: [{ id: "layout", label: "Layouts & Approaches" }] },
  {
    label: "Actions",
    sections: [
      { id: "buttons", label: "Buttons" },
      { id: "links", label: "Links" },
      { id: "copy", label: "Copy Actions" },
    ],
  },
  { label: "Forms", sections: [{ id: "forms", label: "Form Inputs" }] },
  {
    label: "Surfaces",
    sections: [
      { id: "boxes", label: "Boxes & Cards" },
      { id: "badges", label: "Badges & Chips" },
    ],
  },
  {
    label: "Overlays & Menus",
    sections: [
      { id: "overlays", label: "Overlays" },
      { id: "menus", label: "Menus" },
    ],
  },
  { label: "Patterns", sections: [{ id: "collections", label: "Collections" }] },
];

function NavColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={1}>
      <div className={groupLabelClass} style={{ color: semanticColors.textSubtle }}>
        {label}
      </div>
      {children}
    </Stack>
  );
}

function CategoryNav() {
  return (
    <Stack gap={5}>
      {NAV.map((category) => (
        <NavColumn key={category.label} label={category.label}>
          {category.sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}
            >
              {section.label}
            </a>
          ))}
        </NavColumn>
      ))}
      <NavColumn label="Related">
        <a href="/styles" className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}>
          Classic guide →
        </a>
        <a
          href="/styles/oxmarkdown"
          className={`${link} ${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`}
        >
          OxMarkdown →
        </a>
      </NavColumn>
    </Stack>
  );
}

// ─── Component Guide (simple list) ───────────────────────────────────────────

type GuideItem = { name: string; description: string };
type GuideGroup = { label: string; items: GuideItem[] };

const GUIDE_GROUPS: GuideGroup[] = [
  {
    label: "Layout & navigation",
    items: [
      {
        name: "AppLayout",
        description:
          "The app shell — top nav, mobile menu, page container. Every page wraps its content in this.",
      },
      {
        name: "CenterContent / DrawerContent",
        description: "AppLayout's two content-area types — see the Layout category.",
      },
    ],
  },
  {
    label: "Form & input",
    items: [
      {
        name: "Input",
        description: "A text or textarea field, with its label, border, and padding already built in.",
      },
      {
        name: "NumberInput",
        description: "A numeric field with +/− steppers, free typing, and inline math (+ − × ÷ ^).",
      },
    ],
  },
  {
    label: "Status & tags",
    items: [
      { name: "Badge", description: "A status pill — Complete, Overdue, Invited, and friends." },
      { name: "Chip", description: "A filter or category tag, with an active state and click handler." },
    ],
  },
  {
    label: "Collections & actions",
    items: [
      {
        name: "SearchCollection",
        description: 'A searchable, scrollable list — with room for an "add new" row.',
      },
      {
        name: "CopyField",
        description: "A read-only field with a Copy button, for commands, tokens, and share links.",
      },
    ],
  },
  {
    label: "Overlays & menus",
    items: [
      { name: "Modal", description: "A centered dialog — closes on a backdrop click or Escape." },
      { name: "CircleButton", description: "A round, icon-only button — bring your own icon." },
      {
        name: "MoreMenu",
        description: 'A "•••" action menu that handles its own open/close state for you.',
      },
      {
        name: "ErrorPanel",
        description: "An access-denied / something-went-wrong card for a route's ErrorBoundary.",
      },
    ],
  },
];

function GuideList() {
  return (
    <Grid gap={5} minColumnWidth={260} style={{ alignItems: "start" }}>
      {GUIDE_GROUPS.map((group) => (
        <Surface key={group.label} className={sprinkles({ p: 5 })}>
          <Stack gap={3}>
            <div className={groupLabelClass} style={{ color: semanticColors.textSubtle }}>
              {group.label}
            </div>
            <Stack gap={3}>
              {group.items.map((item) => (
                <Cluster key={item.name} gap={3} align="baseline">
                  <code
                    className={`${textSize.sm} ${sprinkles({ fontFamily: "mono", fontWeight: "semibold", flexShrink: 0 })}`}
                    style={{ color: semanticColors.textBrand }}
                  >
                    {item.name}
                  </code>
                  <span className={textSize.sm} style={{ color: semanticColors.textPrimary }}>
                    {item.description}
                  </span>
                </Cluster>
              ))}
            </Stack>
          </Stack>
        </Surface>
      ))}
    </Grid>
  );
}

function ComponentGuideSection() {
  return (
    <Section id="component-guide" title="Component Guide">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "640px" }}>
          Most UI needs in this app are already solved by something below —
          check here first. Need something that isn't listed, or thinking
          about adding a new shared component? See <Code>AGENTS.md</Code>{" "}
          for the rules on when to extract one.
        </p>
        <GuideList />
      </Stack>
    </Section>
  );
}

// ─── Colors ───────────────────────────────────────────────────────────────

type ColorFormat = "hex" | "rgb" | "name";

/** Parses whatever `getComputedStyle(...).backgroundColor` gives back
 * (always `rgb(r, g, b)` or `rgba(r, g, b, a)`, never the original
 * `var(--x)`/hex/hsl the CSS actually specified) into components. */
function parseRgbComponents(input: string): { r: number; g: number; b: number } | null {
  const match = input.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function toRgb({ r, g, b }: { r: number; g: number; b: number }): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** One color swatch — a big block of the actual color (so it reads as a
 * swatch, not a spec sheet), with the value in whichever `format` is
 * selected shown underneath, small and secondary. Click to copy that
 * value. Hex/rgb aren't knowable statically for a `--color-*` semantic
 * token (it depends on the current color scheme), so they're read off
 * the swatch's own resolved `background-color` after mount instead of
 * being hardcoded — which also means they're automatically correct for
 * whichever scheme is currently active. `scheme` is only a dependency to
 * force that re-read if the OS scheme flips while the page is open. */
function Swatch({ name, format, scheme }: { name: string; format: ColorFormat; scheme: string }) {
  const swatchRef = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState<{ hex: string; rgb: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = swatchRef.current;
    if (!el) return;
    const components = parseRgbComponents(getComputedStyle(el).backgroundColor);
    setResolved(components ? { hex: toHex(components), rgb: toRgb(components) } : null);
  }, [name, scheme]);

  const value =
    format === "name" ? name : format === "hex" ? resolved?.hex ?? name : resolved?.rgb ?? name;

  function handleClick() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`Click to copy ${value}`}
      aria-label={`Copy ${value}`}
      className={sprinkles({ display: "flex", flexDirection: "column", gap: 2 })}
      style={{ width: "100%", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
    >
      <div
        ref={swatchRef}
        style={{
          height: "84px",
          borderRadius: "8px",
          border: "1px solid rgba(0, 0, 0, 0.08)",
          background: `var(${name})`,
        }}
      />
      <code
        className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
        style={{ color: copied ? semanticColors.textBrand : semanticColors.textSubtle }}
      >
        {copied ? "Copied!" : value}
      </code>
    </button>
  );
}

function SwatchGroup({
  label,
  names,
  format,
  scheme,
}: {
  label: string;
  names: string[];
  format: ColorFormat;
  scheme: string;
}) {
  return (
    <Stack gap={3}>
      <div className={groupLabelClass} style={{ color: semanticColors.textSubtle }}>
        {label}
      </div>
      <Grid gap={3} minColumnWidth={110}>
        {names.map((name) => (
          <Swatch key={name} name={name} format={format} scheme={scheme} />
        ))}
      </Grid>
    </Stack>
  );
}

function FormatToggle({ format, onChange }: { format: ColorFormat; onChange: (format: ColorFormat) => void }) {
  const options: ColorFormat[] = ["hex", "rgb", "name"];
  return (
    <Cluster gap={2} align="center">
      <span
        className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
        style={{ color: semanticColors.textSubtle }}
      >
        Copy as:
      </span>
      {options.map((option) => (
        <Chip key={option} active={format === option} onClick={() => onChange(option)}>
          {option.toUpperCase()}
        </Chip>
      ))}
    </Cluster>
  );
}

const PALETTE_GROUPS: Array<{ label: string; names: string[] }> = [
  { label: "Plum (brand / purple)", names: ["--plum-200", "--plum-300", "--plum-400", "--plum-700"] },
  { label: "Cactus (green)", names: ["--cactus-300", "--cactus-500"] },
  { label: "Clay (red / terracotta)", names: ["--clay-300", "--clay-500"] },
  { label: "Dune (yellow)", names: ["--dune-300", "--dune-500"] },
  { label: "Bloom (pink)", names: ["--bloom-500"] },
  { label: "Moonlight (accent)", names: ["--moonlight-500"] },
  { label: "Surface Day", names: ["--surface-day-100", "--surface-day-300", "--surface-day-500"] },
  { label: "Surface Night", names: ["--surface-night-100", "--surface-night-300", "--surface-night-500"] },
  { label: "Neutral", names: ["--white"] },
];

const ALIAS_GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: "Brand colors",
    names: [
      "--white",
      "--purple",
      "--purple-light",
      "--pink",
      "--yellow",
      "--yellow-light",
      "--green",
      "--green-light",
      "--red",
      "--red-light",
      "--moon",
    ],
  },
  { label: "Surface (light)", names: ["--farground", "--midground", "--foreground"] },
  { label: "Surface (dark)", names: ["--dark-farground", "--dark-midground", "--dark-foreground"] },
  { label: "Text", names: ["--text-subtle", "--text-subtle-dark"] },
];

const SEMANTIC_GROUPS: Array<{ label: string; names: string[] }> = [
  {
    label: "Text",
    names: ["--color-text-primary", "--color-text-brand", "--color-text-subtle", "--color-text-danger"],
  },
  {
    label: "Surface",
    names: [
      "--color-surface-page",
      "--color-surface-card",
      "--color-surface-inset",
      "--color-surface-border",
    ],
  },
  { label: "Form fields", names: ["--color-field-bg", "--color-field-border", "--color-field-text"] },
  { label: "Navigation", names: ["--color-nav-active-bg"] },
];

function ColorsSection() {
  const [format, setFormat] = useState<ColorFormat>("name");
  const scheme = useSchemePref() ?? "light";

  return (
    <Section
      id="colors"
      title="Colors"
      actions={<FormatToggle format={format} onChange={setFormat} />}
    >
      <Stack gap={8}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          Every color the app uses, defined in <Code>:root</Code> (
          <Code>styles/root.css</Code>) and typed in{" "}
          <Code>stamps/tokens.ts</Code>. Click any swatch to copy its
          value — semantic tokens copy whichever of light/dark is
          currently showing.
        </p>

        <Stack gap={5}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Palette — raw values
          </div>
          {PALETTE_GROUPS.map((group) => (
            <SwatchGroup key={group.label} label={group.label} names={group.names} format={format} scheme={scheme} />
          ))}
        </Stack>

        <Stack gap={5}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Literal aliases
          </div>
          {ALIAS_GROUPS.map((group) => (
            <SwatchGroup key={group.label} label={group.label} names={group.names} format={format} scheme={scheme} />
          ))}
        </Stack>

        <Stack gap={5}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Semantic tokens — flip automatically with dark mode
          </div>
          {SEMANTIC_GROUPS.map((group) => (
            <SwatchGroup key={group.label} label={group.label} names={group.names} format={format} scheme={scheme} />
          ))}
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Typography ────────────────────────────────────────────────────────────

type TypeSizeToken = keyof typeof textSize;
type FontWeightToken = "normal" | "medium" | "semibold" | "bold";

const TYPE_SCALE: Array<{ token: TypeSizeToken; spec: string }> = [
  { token: "xs", spec: "0.75rem / 1rem (12px / 16px)" },
  { token: "sm", spec: "0.875rem / 1.25rem (14px / 20px)" },
  { token: "base", spec: "1rem / 1.5rem (16px / 24px)" },
  { token: "lg", spec: "1.125rem / 1.75rem (18px / 28px)" },
  { token: "xl", spec: "1.25rem / 1.75rem (20px / 28px)" },
  { token: "2xl", spec: "1.5rem / 2rem (24px / 32px)" },
  { token: "3xl", spec: "1.875rem / 2.25rem (30px / 36px)" },
  { token: "4xl", spec: "2.25rem / 2.5rem (36px / 40px)" },
  { token: "6xl", spec: "3.75rem / 1 (60px / 60px)" },
];

const FONT_WEIGHTS: Array<{ token: FontWeightToken; value: number }> = [
  { token: "normal", value: 400 },
  { token: "medium", value: 500 },
  { token: "semibold", value: 600 },
  { token: "bold", value: 700 },
];

const FONT_FAMILIES: Array<{ label: string; family?: "mono" | "hand" }> = [
  { label: "sans — OT L22 Variable (body default, no override needed)" },
  { label: "mono", family: "mono" },
  { label: "hand", family: "hand" },
];

/** A label caption under a specimen — same small/secondary/mono treatment
 * as a color swatch's var name, so type specimens read the same way
 * swatches do: the big sample IS the value, the caption just names it. */
function SpecimenCaption({ children }: { children: ReactNode }) {
  return (
    <code
      className={`${textSize.xs} ${sprinkles({ fontFamily: "mono" })}`}
      style={{ color: semanticColors.textSubtle }}
    >
      {children}
    </code>
  );
}

function TypeSpecimen({ token, spec }: { token: TypeSizeToken; spec: string }) {
  return (
    <Surface className={sprinkles({ p: 4 })}>
      <Stack gap={1}>
        <div className={textSize[token]} style={{ color: semanticColors.textPrimary }}>
          The quick brown fox jumps over the lazy dog
        </div>
        <SpecimenCaption>
          textSize.{token} — {spec}
        </SpecimenCaption>
      </Stack>
    </Surface>
  );
}

function WeightSpecimen({ token, value }: { token: FontWeightToken; value: number }) {
  return (
    <Surface className={sprinkles({ p: 4 })}>
      <Stack gap={1}>
        <div
          className={`${textSize.xl} ${sprinkles({ fontWeight: token })}`}
          style={{ color: semanticColors.textPrimary }}
        >
          Aa
        </div>
        <SpecimenCaption>
          {token} ({value})
        </SpecimenCaption>
      </Stack>
    </Surface>
  );
}

function FamilySpecimen({ label, family }: { label: string; family?: "mono" | "hand" }) {
  return (
    <Surface className={sprinkles({ p: 4 })}>
      <Stack gap={1}>
        <div
          className={`${textSize.lg} ${family ? sprinkles({ fontFamily: family }) : ""}`}
          style={{ color: semanticColors.textPrimary }}
        >
          The quick brown fox jumps over the lazy dog
        </div>
        <SpecimenCaption>
          {label}
          {family ? ` — sprinkles({ fontFamily: "${family}" })` : ""}
        </SpecimenCaption>
      </Stack>
    </Surface>
  );
}

function TypographySection() {
  return (
    <Section id="typography" title="Typography">
      <Stack gap={8}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          Font size is <Code>stamps/typography.css</Code>'s <Code>textSize</Code>{" "}
          (pairs font-size + line-height together, so don't set them
          separately) — everything else here is a plain{" "}
          <Code>sprinkles()</Code> call.
        </p>

        <Stack gap={4}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Scale — textSize
          </div>
          <Stack gap={4}>
            {TYPE_SCALE.map(({ token, spec }) => (
              <TypeSpecimen key={token} token={token} spec={spec} />
            ))}
          </Stack>
        </Stack>

        <Stack gap={4}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Weight — sprinkles({"{ fontWeight }"})
          </div>
          <Grid gap={4} minColumnWidth={140}>
            {FONT_WEIGHTS.map(({ token, value }) => (
              <WeightSpecimen key={token} token={token} value={value} />
            ))}
          </Grid>
        </Stack>

        <Stack gap={4}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Family — sprinkles({"{ fontFamily }"})
          </div>
          <Stack gap={4}>
            {FONT_FAMILIES.map((f) => (
              <FamilySpecimen key={f.label} label={f.label} family={f.family} />
            ))}
          </Stack>
        </Stack>

        <Stack gap={4}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Utilities
          </div>
          <Surface className={sprinkles({ p: 4 })}>
            <Stack gap={2}>
              <div className={truncate} style={{ maxWidth: "220px", color: semanticColors.textPrimary }}>
                a-long-filename-that-would-otherwise-wrap-or-overflow.md
              </div>
              <SpecimenCaption>truncate — stamps/typography.css</SpecimenCaption>
            </Stack>
          </Surface>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Layout & Approaches ──────────────────────────────────────────────────

function LabeledCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
        {label}
      </div>
      <p className={textSize.sm} style={{ color: semanticColors.textPrimary, margin: 0 }}>
        {children}
      </p>
    </Stack>
  );
}

const CONTENT_AREA_TYPES: Array<{ name: string; source: string; description: ReactNode }> = [
  {
    name: "CenterContent",
    source: "stamps/CenterContent",
    description: (
      <>
        Centers content in a max-width column — the default choice for
        anything read top-to-bottom with no persistent side panel (forms,
        docs, dashboards, detail pages). <Code>maxWidth</Code> defaults to{" "}
        <Code>680</Code> and is adjustable per page, e.g.{" "}
        <Code>{"<CenterContent maxWidth={860}>"}</Code>. Common precedents
        already in use: <Code>420</Code> (single-column cards),{" "}
        <Code>480</Code> (forms/detail panels), <Code>640</Code> (a
        record's own detail page), <Code>860</Code> (wide/dashboard
        content). This page's own main column uses the 680 default.
      </>
    ),
  },
  {
    name: "DrawerContent",
    source: "stamps/DrawerContent",
    description: (
      <>
        Full-width content with a persistent left drawer — for anything
        that needs its own always-visible nav/filter/tree alongside the
        content, like the Vault folder tree (this is meant to be a
        drop-in replacement for Vault's own hand-rolled drawer). Slides
        in/out as an overlay below 860px, with its own backdrop, close
        button, and a mobile-only open toggle labeled with{" "}
        <Code>title</Code> (e.g. <Code>{'<DrawerContent title="Vault">'}</Code>).
        This page uses it — the drawer on the left is{" "}
        <Code>{"<CategoryNav />"}</Code>, titled "Sections".
      </>
    ),
  },
];

const WITHIN_CONTENT_PRIMITIVES: Array<{ name: string; source: string; description: ReactNode }> = [
  {
    name: "Stack",
    source: "stamps/Stack",
    description: (
      <>
        A vertical rhythm — <Code>{"<Stack gap={4}>"}</Code> instead of{" "}
        <Code>{'sprinkles({ display: "flex", flexDirection: "column", gap: 4 })'}</Code>.
      </>
    ),
  },
  {
    name: "Cluster",
    source: "stamps/Cluster",
    description: (
      <>
        A wrapping horizontal row — <Code>{'<Cluster gap={3} align="baseline">'}</Code>, for
        label/value pairs, tag lists, and button groups.
      </>
    ),
  },
  {
    name: "Grid",
    source: "stamps/Grid",
    description: (
      <>
        A real CSS grid — <Code>{"<Grid gap={4} minColumnWidth={260}>"}</Code>, auto-fitting as
        many columns as fit. The Component Guide's cards above use it.
      </>
    ),
  },
];

function LayoutSection() {
  return (
    <Section id="layout" title="Layouts & Approaches">
      <Stack gap={8}>
        <Stack gap={4}>
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "640px" }}>
            Every page picks exactly one of two content-area types for
            what goes inside <Code>AppLayout</Code>'s shell (the same top
            nav / mobile menu on every route) — this is that choice.
          </p>
          <Grid gap={4} minColumnWidth={260} style={{ alignItems: "start" }}>
            {CONTENT_AREA_TYPES.map((type) => (
              <Surface key={type.name} className={sprinkles({ p: 5 })}>
                <LabeledCard label={`${type.name} — ${type.source}`}>{type.description}</LabeledCard>
              </Surface>
            ))}
          </Grid>
        </Stack>

        <Stack gap={4}>
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "640px" }}>
            Within either content area, a few small primitives keep
            composition consistent instead of ad hoc one-off flex/grid
            styles:
          </p>
          <Grid gap={4} minColumnWidth={220} style={{ alignItems: "start" }}>
            {WITHIN_CONTENT_PRIMITIVES.map((primitive) => (
              <Surface key={primitive.name} className={sprinkles({ p: 5 })}>
                <LabeledCard label={`${primitive.name} — ${primitive.source}`}>
                  {primitive.description}
                </LabeledCard>
              </Surface>
            ))}
          </Grid>
        </Stack>

        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "640px" }}>
          More layout <em>types</em> — a settings page, a real dashboard
          grid, … — belong here too as they get identified. This section
          is intentionally just a start.
        </p>
      </Stack>
    </Section>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function MakerStamps() {
  return (
    <AppLayout>
      <DrawerContent drawer={<CategoryNav />} title="Sections">
        <CenterContent>
          <Stack gap={16}>
            <div>
              <h1
                className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold", mb: 2 })}`}
                style={{ color: semanticColors.textPrimary }}
              >
                Stamps
              </h1>
              <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
                Our design system — tokens, components, and patterns for
                the Fruits app. This page is a clean-slate rebuild of{" "}
                <a href="/styles" className={link}>
                  /styles
                </a>{" "}
                using <Code>stamps</Code> primitives only — sections not
                migrated here yet link back to the classic guide.
              </p>
            </div>

            <ComponentGuideSection />

            <ColorsSection />
            <TypographySection />
            <StubSection id="spacing" title="Spacing" />
            <StubSection id="icons" title="Icons" />

            <LayoutSection />

            <StubSection id="buttons" title="Buttons" />
            <StubSection id="links" title="Links" />
            <StubSection id="copy" title="Copy Actions" />
            <StubSection id="forms" title="Form Inputs" />
            <StubSection id="boxes" title="Boxes & Cards" />
            <StubSection id="badges" title="Badges & Chips" />
            <StubSection id="overlays" title="Overlays" />
            <StubSection id="menus" title="Menus" />
            <StubSection id="collections" title="Collections" />
          </Stack>
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
