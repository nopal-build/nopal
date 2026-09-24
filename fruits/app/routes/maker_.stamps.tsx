// app/routes/maker_.stamps.tsx
// Stamps design-system guide, take two — lives under /maker (Admin/Super
// only, same gate as the rest of the Maker section) as a clean-slate
// rebuild of the classic guide (`/styles`, styles.tsx). Built entirely
// with `stamps` primitives (sprinkles/textSize/tokens/CenterContent/
// DrawerContent/Stack/Cluster/Grid/…), no Tailwind — see AGENTS.md's "UI
// conventions" section for why. Every category has now been migrated
// here (`/styles` is no longer linked from this page) — `/styles` itself
// hasn't been deleted yet in case anything still deep-links to it, but
// this page is the one to keep updated going forward.
//
// Also doubles as the live reference for the two `AppLayout` content-area
// types: this whole page is a `DrawerContent` (see `#layout` for the
// other type, `CenterContent`, which the main content column below uses)
// with the category nav living in the drawer instead of a horizontal bar
// up top.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LoaderFunctionArgs } from "react-router";
import {
  Link,
  data,
  redirect,
  useRouteError,
  useSearchParams,
  isRouteErrorResponse,
} from "react-router";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { CardTabs } from "../components/stamps-candidates/CardTabs";
import { PinnedCard, PinnedCardWall } from "../components/stamps-candidates/PinnedCard";
import { SlopeGauge } from "../components/stamps-candidates/SlopeGauge";
import { useSchemePref } from "../hooks/useSchemePref";
import { Surface } from "stamps/Surface";
import { surfaceBorderOnly } from "stamps/surface.css";
import { Badge } from "stamps/Badge";
import type { BadgeVariants } from "stamps/badge.css";
import { ErrorPanel } from "stamps/ErrorPanel";
import { CenterContent } from "stamps/CenterContent";
import { DrawerContent } from "stamps/DrawerContent";
import { Chip } from "stamps/Chip";
import { Input } from "stamps/Input";
import { CopyField } from "stamps/CopyField";
import { CircleButton } from "stamps/CircleButton";
import { HamburgerNeqIcon } from "stamps/HamburgerNeqIcon";
import { SidebarToggleIcon } from "stamps/SidebarToggleIcon";
import { Modal } from "stamps/Modal";
import { MoreMenu, MoreIcon } from "stamps/MoreMenu";
import { SearchCollection } from "stamps/SearchCollection";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { Grid } from "stamps/Grid";
import { useScrollSpy } from "stamps/useScrollSpy";
import { link } from "stamps/link.css";
import { navLink } from "stamps/navLink.css";
import { toggleButton } from "stamps/drawerContent.css";
import { button, type ButtonVariants } from "stamps/button.css";
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
  const user = await requireMakerAccess(request);
  return { user };
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


// ─── Category nav (lives in the drawer) ──────────────────────────────────────

type NavSection = { id: string; label: string };
type NavCategory = { label: string; sections: NavSection[] };

const NAV: NavCategory[] = [
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
  { label: "Candidates", sections: [{ id: "candidates", label: "Stamps Candidates" }] },
];

// Stable (module-level, never re-created) so `useScrollSpy` doesn't tear
// down and rebuild its `IntersectionObserver` on every render.
const ALL_SECTION_IDS: string[] = NAV.flatMap((category) => category.sections.map((s) => s.id));

const drawerNavLinkClass = `${textSize.sm} ${sprinkles({ fontFamily: "mono" })}`;

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

function CategoryNav({ activeId }: { activeId: string | null }) {
  return (
    <Stack gap={5}>
      {NAV.map((category) => (
        <NavColumn key={category.label} label={category.label}>
          {category.sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={`${navLink({ context: "drawer", active: section.id === activeId })} ${drawerNavLinkClass}`}
            >
              {section.label}
            </a>
          ))}
        </NavColumn>
      ))}
      <NavColumn label="Related">
        <a href="/maker/stamps/oxmarkdown" className={`${navLink({ context: "drawer" })} ${drawerNavLinkClass}`}>
          OxMarkdown →
        </a>
        <a href="/maker/stamps/scratch" className={`${navLink({ context: "drawer" })} ${drawerNavLinkClass}`}>
          Scratchpad →
        </a>
      </NavColumn>
    </Stack>
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

function StyleSpecimen({ label, italic }: { label: string; italic?: boolean }) {
  return (
    <Surface className={sprinkles({ p: 4 })}>
      <Stack gap={1}>
        <div
          className={`${textSize.lg} ${italic ? sprinkles({ fontStyle: "italic" }) : ""}`}
          style={{ color: semanticColors.textPrimary }}
        >
          The quick brown fox jumps over the lazy dog
        </div>
        <SpecimenCaption>
          {label}
          {italic ? ' — sprinkles({ fontStyle: "italic" })' : ""}
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
            Style — sprinkles({"{ fontStyle }"})
          </div>
          <Stack gap={4}>
            <StyleSpecimen label="normal" />
            <StyleSpecimen label="italic" italic />
          </Stack>
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
            OT L22 Variable has no real italic — its only variable axis is{" "}
            <Code>wght</Code>, and neither the <Code>head</Code> nor{" "}
            <Code>OS/2</Code> table's italic flags are set. What you see
            above is the browser's synthesized/oblique slant (see{" "}
            <Code>font-synthesis</Code>), not a drawn italic face — a real
            one would need its own <Code>@font-face</Code> file or an{" "}
            <Code>ital</Code>/<Code>slnt</Code> axis, neither of which this
            font has.
          </p>
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

// ─── Spacing ───────────────────────────────────────────────────────────────

const SPACE_SCALE: Array<{ token: string; rem: string; px: number }> = [
  { token: "0", rem: "0", px: 0 },
  { token: "0.5", rem: "0.125rem", px: 2 },
  { token: "1", rem: "0.25rem", px: 4 },
  { token: "1.5", rem: "0.375rem", px: 6 },
  { token: "2", rem: "0.5rem", px: 8 },
  { token: "2.5", rem: "0.625rem", px: 10 },
  { token: "3", rem: "0.75rem", px: 12 },
  { token: "4", rem: "1rem", px: 16 },
  { token: "5", rem: "1.25rem", px: 20 },
  { token: "6", rem: "1.5rem", px: 24 },
  { token: "8", rem: "2rem", px: 32 },
  { token: "9", rem: "2.25rem", px: 36 },
  { token: "10", rem: "2.5rem", px: 40 },
  { token: "12", rem: "3rem", px: 48 },
  { token: "16", rem: "4rem", px: 64 },
  { token: "20", rem: "5rem", px: 80 },
  { token: "24", rem: "6rem", px: 96 },
  { token: "40", rem: "10rem", px: 160 },
];

const SPACE_SHORTHANDS = [
  "p",
  "px",
  "py",
  "pt",
  "pb",
  "pl",
  "pr",
  "m",
  "mx",
  "my",
  "mt",
  "mb",
  "ml",
  "mr",
  "gap",
  "rowGap",
  "columnGap",
];

/** One rung of the scale — a bar whose width IS the actual size (same
 * swatch philosophy as Colors: show the real thing, caption it small).
 * `Math.max(px, 2)` keeps the `0` rung visible as a thin mark instead of
 * disappearing entirely. */
function SpaceRow({ token, rem, px }: { token: string; rem: string; px: number }) {
  return (
    <Cluster gap={4} align="center" wrap={false}>
      <code
        className={`${textSize.sm} ${sprinkles({ fontFamily: "mono", fontWeight: "semibold", flexShrink: 0 })}`}
        style={{ color: semanticColors.textBrand, minWidth: "28px" }}
      >
        {token}
      </code>
      <div
        style={{
          height: "10px",
          width: `${Math.max(px, 2)}px`,
          background: semanticColors.textBrand,
          borderRadius: "2px",
          flexShrink: 0,
        }}
      />
      <SpecimenCaption>
        {rem} ({px}px)
      </SpecimenCaption>
    </Cluster>
  );
}

function SpacingSection() {
  return (
    <Section id="spacing" title="Spacing">
      <Stack gap={8}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          One scale, shared by every padding/margin/gap prop —{" "}
          <Code>sprinkles()</Code> is a TypeScript error for anything off
          it, where a Tailwind class like <Code>p-4.5</Code> would just
          silently render nothing.
        </p>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Scale
          </div>
          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={2}>
              {SPACE_SCALE.map((step) => (
                <SpaceRow key={step.token} {...step} />
              ))}
            </Stack>
          </Surface>
        </Stack>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Shorthands — sprinkles({"{ ... }"})
          </div>
          <Cluster gap={2}>
            {SPACE_SHORTHANDS.map((name) => (
              <Code key={name}>{name}</Code>
            ))}
          </Cluster>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────────

/** Self-contained — owns its own open/closed state so it can drop into
 * this page without wiring anything up. Mirrors how AppLayout's own
 * mobile nav toggle pairs `HamburgerNeqIcon` with a click handler. */
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

function IconsSection() {
  return (
    <Section id="icons" title="Icons">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          A handful of small, purpose-built glyphs — none from an icon
          font/library, each its own tiny component so it can use{" "}
          <Code>currentColor</Code> and animate on its own terms.
        </p>

        <Grid gap={4} minColumnWidth={220} style={{ alignItems: "start" }}>
          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={3}>
              <HamburgerNeqDemo />
              <LabeledCard label="HamburgerNeqIcon — stamps/HamburgerNeqIcon">
                Morphs into a "≠"-style mark on click — the top/bottom
                lines slide together, the middle rotates into the slash.
                AppLayout's own mobile nav toggle uses this. Click it.
              </LabeledCard>
            </Stack>
          </Surface>

          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={3}>
              <Cluster gap={3}>
                <div className={toggleButton} aria-hidden="true">
                  <SidebarToggleIcon open={false} />
                </div>
                <div className={toggleButton} aria-hidden="true">
                  <SidebarToggleIcon open />
                </div>
              </Cluster>
              <LabeledCard label="SidebarToggleIcon — stamps/SidebarToggleIcon">
                Two fixed states, not animated — closed (left) and open
                (right). DrawerContent's own mobile open/close toggle uses
                these two (see the drawer on the left of this page).
              </LabeledCard>
            </Stack>
          </Surface>

          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={3}>
              <CircleButton aria-label="More actions (decorative)">
                <MoreIcon />
              </CircleButton>
              <LabeledCard label="MoreIcon — stamps/MoreMenu">
                An oversized "•••" — MoreMenu's default trigger glyph,
                bigger and bolder than a typed ellipsis character.
              </LabeledCard>
            </Stack>
          </Surface>
        </Grid>
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
        many columns as fit. Used throughout this page for card grids
        (Colors' swatch groups, Icons, the cards right above this one).
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

// ─── Buttons ────────────────────────────────────────────────────────────

type ButtonVariant = NonNullable<ButtonVariants>["variant"];

type ButtonExample = {
  variant: ButtonVariant;
  label: string;
  code: string;
  note?: string;
  style?: CSSProperties;
};

const BUTTON_VARIANTS: ButtonExample[] = [
  { variant: "primary", label: "Primary Action", code: 'button({ variant: "primary" })' },
  {
    variant: "purple",
    label: "Purple Button",
    code: 'button({ variant: "purple" })',
    note: "Same as primary, minus the baked-in padding — bring your own.",
    style: { padding: "8px 20px" },
  },
  { variant: "secondary", label: "Secondary Action", code: 'button({ variant: "secondary" })' },
  { variant: "yellow", label: "Soft Action", code: 'button({ variant: "yellow" })' },
  {
    variant: "outline",
    label: "Outline",
    code: 'button({ variant: "outline" })',
    note: "No padding or display baked in at all — bring both.",
    style: { padding: "8px 16px", display: "inline-flex" },
  },
];

/** One button, rendered for real (not a swatch standing in for it) —
 * captioned with the exact `button(...)` call that produced it. */
function ButtonSpecimen({
  variant,
  tint,
  label,
  code,
  note,
  style,
  disabled,
}: ButtonExample & { tint?: "danger"; disabled?: boolean }) {
  return (
    <Stack gap={2} align="flex-start" style={{ maxWidth: "220px" }}>
      <button type="button" className={button({ variant, tint })} style={style} disabled={disabled}>
        {label}
      </button>
      <SpecimenCaption>{code}</SpecimenCaption>
      {note && (
        <p className={textSize.xs} style={{ color: semanticColors.textSubtle, margin: 0 }}>
          {note}
        </p>
      )}
    </Stack>
  );
}

function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons">
      <Stack gap={8}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>button({"{ variant, tint }"})</Code> from{" "}
          <Code>stamps/button.css</Code> — a raw recipe, not a fixed{" "}
          <Code>{"<Button>"}</Code> component, since call sites apply it to
          a plain <Code>{"<button>"}</Code>, an <Code>{"<a>"}</Code>, or a{" "}
          <Code>{"<Link>"}</Code> today.
        </p>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Variants
          </div>
          <Cluster gap={6} align="flex-start">
            {BUTTON_VARIANTS.map((v) => (
              <ButtonSpecimen key={v.variant} {...v} />
            ))}
          </Cluster>
        </Stack>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Danger tint
          </div>
          <Cluster gap={6} align="flex-start">
            <ButtonSpecimen
              variant="secondary"
              tint="danger"
              label="Delete Project"
              code='button({ variant: "secondary", tint: "danger" })'
              note="Only meaningful on secondary today — the only variant the old --btn-color override was ever used on."
            />
          </Cluster>
        </Stack>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            Disabled
          </div>
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
            Baked into the recipe itself now (an <Code>{"&:disabled"}</Code>{" "}
            selector in <Code>button.css.ts</Code>'s <Code>base</Code>) —
            just add the real <Code>disabled</Code> attribute, no extra
            class needed.
          </p>
          <Cluster gap={6} align="flex-start">
            <ButtonSpecimen
              variant="primary"
              label="Disabled Primary"
              code='button({ variant: "primary" })'
              disabled
            />
            <ButtonSpecimen
              variant="secondary"
              label="Disabled Secondary"
              code='button({ variant: "secondary" })'
              disabled
            />
          </Cluster>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Links ────────────────────────────────────────────────────────

const linkAsButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  cursor: "pointer",
};

function LinksSection() {
  return (
    <Section id="links" title="Links">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>link</Code> from <Code>stamps/link.css</Code> — one plain
          class, no variants — applied to an <Code>{"<a>"}</Code>, a{" "}
          <Code>{"<Link>"}</Code>, or a plain <Code>{"<button>"}</Code>{" "}
          styled as an inline "cancel"/"undo" action. For a navigation
          item (the drawer on the left, AppLayout's own top nav) use{" "}
          <Code>navLink</Code> instead — that one carries its own
          active/current-page highlight, which a body-text link never
          needs.
        </p>

        <Surface className={sprinkles({ p: 5 })}>
          <Stack gap={4}>
            <p className={textSize.sm} style={{ color: semanticColors.textPrimary, maxWidth: "420px", margin: 0 }}>
              Reads inline, right in a sentence — here's{" "}
              <a href="#links" className={link}>
                a real link
              </a>{" "}
              sitting inside body text, and here's{" "}
              <button type="button" className={link} style={linkAsButtonStyle}>
                a button styled the same way
              </button>
              . Hover either to see the underline.
            </p>
            <SpecimenCaption>{"<a className={link}> · <button className={link}>"}</SpecimenCaption>
          </Stack>
        </Surface>
      </Stack>
    </Section>
  );
}

// ─── Copy Actions ───────────────────────────────────────────────────────

function CopyActionsSection() {
  return (
    <Section id="copy" title="Copy Actions">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>CopyField</Code> from <Code>stamps/CopyField</Code> — a
          read-only field + Copy button, for install commands, API keys,
          and share links. Degrades gracefully: the field is{" "}
          <Code>readOnly</Code> and auto-selects on focus/click, so
          copying by hand still works even if{" "}
          <Code>navigator.clipboard</Code> is unavailable.
        </p>

        <Surface className={sprinkles({ p: 5 })} style={{ maxWidth: "420px" }}>
          <Stack gap={3}>
            <CopyField value="nopal login --device=cli" ariaLabel="Example CLI login command" />
            <SpecimenCaption>{'<CopyField value="..." ariaLabel="..." />'}</SpecimenCaption>
          </Stack>
        </Surface>
      </Stack>
    </Section>
  );
}

// ─── Form Inputs ───────────────────────────────────────────────────

function FormInputsSection() {
  return (
    <Section id="forms" title="Form Inputs">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>Input</Code> from <Code>stamps/Input</Code> — label,
          border, radius, and padding all baked in. Covers{" "}
          <Code>text</Code>, <Code>textarea</Code>, <Code>number</Code>,
          and <Code>date</Code> — pass <Code>type</Code>.
        </p>

        <Grid gap={4} minColumnWidth={220} style={{ alignItems: "start" }}>
          <Input label="Project name" name="project-name" placeholder="Ocotillo" />
          <Input
            label="Notes"
            name="notes"
            type="textarea"
            placeholder="Anything worth remembering…"
          />
          <Input label="Max guests" name="max-guests" type="number" min={0} max={20} step={1} defaultValue="4" />
          <Input label="Start date" name="start-date" type="date" />
        </Grid>

        <Stack gap={3}>
          <div className={groupLabelClass} style={{ color: semanticColors.textBrand }}>
            hideLabel
          </div>
          <p className={textSize.xs} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
            Visually hides the label — e.g. for a compact inline-edit row
            that already shows a heading elsewhere — while keeping it in
            the DOM for screen readers.
          </p>
          <div style={{ maxWidth: "260px" }}>
            <Input label="Search" name="search-demo" placeholder="Search…" hideLabel />
          </div>
          <SpecimenCaption>{'<Input label="Search" hideLabel />'}</SpecimenCaption>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Boxes & Cards ───────────────────────────────────────────────────────

function BoxesSection() {
  return (
    <Section id="boxes" title="Boxes & Cards">
      <Stack gap={6}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>Surface</Code> from <Code>stamps/Surface</Code> — the base
          card/panel primitive most "boxed" UI should sit inside
          (dialogs, dropdown panels, menus, list rows). Border +{" "}
          <Code>surfaceCard</Code> background + 8px radius, baked in.
        </p>

        <Grid gap={4} minColumnWidth={220} style={{ alignItems: "start" }}>
          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={2}>
              <p className={textSize.sm} style={{ color: semanticColors.textPrimary, margin: 0 }}>
                A plain, static panel.
              </p>
              <SpecimenCaption>{"<Surface>"}</SpecimenCaption>
            </Stack>
          </Surface>

          <Surface hoverable className={sprinkles({ p: 5 })}>
            <Stack gap={2}>
              <p className={textSize.sm} style={{ color: semanticColors.textPrimary, margin: 0 }}>
                Hover me — border + shadow. Wrap in a <Code>{"<Link>"}</Code>{" "}
                or give it an <Code>onClick</Code>.
              </p>
              <SpecimenCaption>{"<Surface hoverable>"}</SpecimenCaption>
            </Stack>
          </Surface>

          <Surface className={sprinkles({ p: 5 })}>
            <Stack gap={3}>
              <p className={textSize.sm} style={{ color: semanticColors.textPrimary, margin: 0 }}>
                A nested section, border-only — no second background
                stacked on top of this Surface's own.
              </p>
              <div className={`${surfaceBorderOnly} ${sprinkles({ p: 3 })}`}>
                <SpecimenCaption>surfaceBorderOnly</SpecimenCaption>
              </div>
            </Stack>
          </Surface>
        </Grid>
      </Stack>
    </Section>
  );
}

// ─── Badges & Chips ───────────────────────────────────────────────────

const BADGE_VARIANTS: Array<{ variant: NonNullable<BadgeVariants>["variant"]; label: string }> = [
  { variant: "neutral", label: "Neutral" },
  { variant: "success", label: "Complete" },
  { variant: "warning", label: "Pending" },
  { variant: "danger", label: "Overdue" },
  { variant: "accent", label: "Featured" },
];

/** Self-contained — owns its own active state so it can drop into this
 * page without wiring anything up, same idea as `HamburgerNeqDemo`. */
function ChipDemo() {
  const [active, setActive] = useState(false);
  return (
    <Chip active={active} onClick={() => setActive((a) => !a)}>
      {active ? "Active filter" : "Click to activate"}
    </Chip>
  );
}

function BadgesSection() {
  return (
    <Section id="badges" title="Badges & Chips">
      <Stack gap={8}>
        <Stack gap={3}>
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
            <Code>Badge</Code> from <Code>stamps/Badge</Code> — a semantic
            status pill. Pass <Code>variant</Code>; don't hand-roll a
            pill with inline colors (they won't flip for dark mode).
          </p>
          <Cluster gap={4}>
            {BADGE_VARIANTS.map((b) => (
              <Stack key={b.variant} gap={1} align="flex-start">
                <Badge variant={b.variant}>{b.label}</Badge>
                <SpecimenCaption>{b.variant}</SpecimenCaption>
              </Stack>
            ))}
          </Cluster>
        </Stack>

        <Stack gap={3}>
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
            <Code>Chip</Code> from <Code>stamps/Chip</Code> — a filter or
            category tag. Read-only by default; pass <Code>onClick</Code>{" "}
            to make it an interactive single-select toggle (adds the
            pointer cursor + keyboard support for free). An interactive
            chip is outlined — not filled — while unselected, so it never
            gets mistaken for the plain read-only tag at rest (cursor
            alone isn't enough: it's invisible without a mouse, and
            doesn't exist at all on touch).
          </p>
          <Cluster gap={3} align="center">
            <Chip>Read-only tag</Chip>
            <ChipDemo />
          </Cluster>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Overlays ────────────────────────────────────────────────────────

/** Self-contained — owns the open state a real call site would wire up
 * itself, same idea as `HamburgerNeqDemo`/`ChipDemo`. */
function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={2} align="flex-start">
      <button
        type="button"
        className={button({ variant: "outline" })}
        style={{ padding: "8px 16px", display: "inline-flex" }}
        onClick={() => setOpen(true)}
      >
        Open modal
      </button>
      <SpecimenCaption>{'<Modal open={open} onClose={...} title="...">'}</SpecimenCaption>
      <Modal open={open} onClose={() => setOpen(false)} title="Example Modal">
        <p className={textSize.sm} style={{ color: semanticColors.textPrimary }}>
          Closes on a backdrop click, Escape, or the Close button below —
          nothing else to wire up.
        </p>
      </Modal>
    </Stack>
  );
}

function OverlaysSection() {
  return (
    <Section id="overlays" title="Overlays">
      <Stack gap={4}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>Modal</Code> from <Code>stamps/Modal</Code> — a
          dependency-free centered dialog: full-screen backdrop + a
          centered <Code>Surface</Code> panel. You own the{" "}
          <Code>open</Code> state and the trigger; the modal handles
          closing itself.
        </p>
        <ModalDemo />
      </Stack>
    </Section>
  );
}

// ─── Menus ───────────────────────────────────────────────────────────

function MoreMenuDemo() {
  return (
    <MoreMenu
      items={[
        { label: "Rename", onClick: () => {} },
        { label: "Duplicate", onClick: () => {} },
        { label: "Delete", onClick: () => {}, danger: true },
      ]}
    />
  );
}

function MenusSection() {
  return (
    <Section id="menus" title="Menus">
      <Stack gap={4}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>MoreMenu</Code> from <Code>stamps/MoreMenu</Code> — a
          small <Code>Surface</Code> action menu. Defaults to a{" "}
          <Code>CircleButton</Code> + oversized "•••" (<Code>MoreIcon</Code>)
          trigger — pass your own <Code>trigger</Code> render prop instead
          if you need a different one. Open state, outside-click,
          Escape, and flip/shift positioning near the viewport edge are
          all handled for you; you only supply <Code>items</Code>.
        </p>
        <MoreMenuDemo />
      </Stack>
    </Section>
  );
}

// ─── Collections ─────────────────────────────────────────────────────────

const DEMO_FRUITS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

/** Self-contained — owns its own query state, same idea as the other
 * `*Demo` components on this page. A real call site would drive
 * `searchInputProps`' `value`/`onChange` from wherever the actual list
 * lives instead. */
function SearchCollectionDemo() {
  const [query, setQuery] = useState("");
  const filtered = query
    ? DEMO_FRUITS.filter((f) => f.toLowerCase().includes(query.trim().toLowerCase()))
    : DEMO_FRUITS;

  return (
    <div style={{ maxWidth: "320px" }}>
      <SearchCollection
        items={filtered}
        getKey={(item) => item}
        renderItem={(item) => (
          <div className={`${textSize.sm} ${sprinkles({ p: 2 })}`} style={{ color: semanticColors.textPrimary }}>
            {item}
          </div>
        )}
        emptyState={
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle, margin: 0 }}>
            No matches.
          </p>
        }
        searchInputProps={{
          label: "Search fruits",
          hideLabel: true,
          name: "fruit-search",
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: "Search…",
        }}
        height={180}
      />
    </div>
  );
}

function CollectionsSection() {
  return (
    <Section id="collections" title="Collections">
      <Stack gap={4}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "480px" }}>
          <Code>SearchCollection</Code> from{" "}
          <Code>stamps/SearchCollection</Code> — a <Code>Surface</Code>{" "}
          shell for "search/filter a list, optionally add a new entry":
          a fixed-height scrollable list on top, a search field below.
          It owns layout only, not data — wire your own filtering (like
          the demo below) or submit-to-create.
        </p>
        <SearchCollectionDemo />
      </Stack>
    </Section>
  );
}

// ─── Candidates ──────────────────────────────────────────────────────────────
// Components built in the app that may move into stamps: generic, no app
// code, plain CSS on stamps' semantic variables until one graduates
// (`fruits/app/tests/stampsCandidates.test.ts` holds them to that).

const DEMO_SLOPE = [
  { key: "flat", label: "Flat" },
  { key: "rolling", label: "Rolling" },
  { key: "uphill", label: "Uphill" },
  { key: "steep", label: "Steep" },
  { key: "oh-crap", label: "Oh crap" },
] as const;
type DemoSlopeKey = (typeof DEMO_SLOPE)[number]["key"];

const DEMO_TABS = ["efforts", "photos", "files", "costs", "logbook"] as const;

function CandidatesSection() {
  const [full, setFull] = useState<DemoSlopeKey | null>(null);
  const [compact, setCompact] = useState<DemoSlopeKey | null>("uphill");
  const [params] = useSearchParams();
  const requested = params.get("demoTab");
  const tab = DEMO_TABS.find((t) => t === requested) ?? "efforts";

  return (
    <Section id="candidates" title="Stamps Candidates">
      <Stack gap={10}>
        <p className={textSize.sm} style={{ color: semanticColors.textSubtle, maxWidth: "560px" }}>
          In <Code>fruits/app/components/stamps-candidates</Code>: built for
          the dashboard and the project page, kept free of app code so one
          that earns its place moves into <Code>packages/stamps</Code> with
          its CSS rewritten in vanilla-extract, and one that doesn't is
          deleted.
        </p>

        <Stack gap={3}>
          <SpecimenCaption>SlopeGauge: a slope set by tapping a word (the Steep-o-meter wraps it)</SpecimenCaption>
          <Cluster gap={8} align="flex-end">
            <div style={{ width: 360, maxWidth: "100%" }}>
              <SlopeGauge options={DEMO_SLOPE} chosen={full} onChoose={setFull} caption="How steep is this stretch?" />
            </div>
            <div style={{ width: 260, maxWidth: "100%" }}>
              <SlopeGauge options={DEMO_SLOPE} chosen={compact} onChoose={setCompact} caption="Compact" size="compact" />
            </div>
          </Cluster>
        </Stack>

        <Stack gap={3}>
          <SpecimenCaption>CardTabs: recipe cards in a box, one link per tab</SpecimenCaption>
          <CardTabs
            label="Demo"
            active={tab}
            tabs={DEMO_TABS.map((t) => ({
              key: t,
              label: t[0].toUpperCase() + t.slice(1),
              to: `?demoTab=${t}#candidates`,
            }))}
          >
            <p className={textSize.sm}>The {tab} card is open.</p>
          </CardTabs>
        </Stack>

        <Stack gap={3}>
          <SpecimenCaption>PinnedCard in a PinnedCardWall: the Logbook's cards</SpecimenCaption>
          <PinnedCardWall>
            <PinnedCard title="Lucas J" label="Wed, Aug 26">
              <p className={textSize.sm}>Working with Beaudy and Gerald on site today.</p>
            </PinnedCard>
            <PinnedCard title="James W" label="Thu, Sep 24">
              <p className={textSize.sm}>Windows arrived.</p>
            </PinnedCard>
            <PinnedCard title="Austin" label="Tue, Sep 22">
              <p className={textSize.sm}>The sheet metal shop sent the invoice for the eave flashing and drip edge today. Net 30.</p>
            </PinnedCard>
          </PinnedCardWall>
        </Stack>
      </Stack>
    </Section>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function MakerStamps() {
  const activeId = useScrollSpy(ALL_SECTION_IDS);

  return (
    <AppLayout>
      <DrawerContent drawer={<CategoryNav activeId={activeId} />} title="Sections">
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
                the Fruits app. Built entirely with <Code>stamps</Code>{" "}
                primitives, no Tailwind — a clean-slate rebuild of the
                classic guide, which this page fully replaces.
              </p>
            </div>

            <ColorsSection />
            <TypographySection />
            <SpacingSection />
            <IconsSection />

            <LayoutSection />

            <ButtonsSection />
            <LinksSection />
            <CopyActionsSection />
            <FormInputsSection />
            <BoxesSection />
            <BadgesSection />
            <OverlaysSection />
            <MenusSection />
            <CollectionsSection />

            <CandidatesSection />
          </Stack>
        </CenterContent>
      </DrawerContent>
    </AppLayout>
  );
}
