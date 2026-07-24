// app/routes/fruits_.daily-log-v2.tsx
//
// VISUAL MOCKUP ONLY — no vault/data-layer wiring, nothing here persists.
// Delete or replace once the real design is settled and the actual
// daily-log route (`fruits_.daily-log.tsx`) grows this feature for real.

import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Chip } from "../components/Chip";
import { CircleButton } from "../components/CircleButton";
import OxEditor from "../components/OxEditor";
import { OxEditorGroup } from "../oxmarkdown/OxEditorGroup";
import "../styles/daily-log-v2-mock.css";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  return { user };
}

let mockFileCounter = 0;
let mockCardCounter = 0;

// ─── Day container ──────────────────────────────────────────────────────────
// One bordered, rounded frame per day, holding that day's prose + cards +
// release log. Its own left padding is `0` — the OxEditor/GutterRow content
// inside already reserves the `41px` gutter themselves (`--ox-grid`) — but
// its RIGHT padding matches that same `41px`, so the whole frame reads as a
// symmetric column instead of the usual left-only gutter.

function DayContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dlv2-container ox-tokens"
      style={{ padding: "24px var(--ox-grid, 41px) 24px 0", marginBottom: "48px" }}
    >
      {children}
    </div>
  );
}

// ─── Prose / Card ───────────────────────────────────────────────────────────

/** Plain journal prose — deliberately NOT boxed, so cards visually pop out
 * against it. `groupId` opts this editor into an ancestor `OxEditorGroup`
 * (see that file) so ArrowDown out of the last line here jumps into the
 * first card below, treating the two independent editors as one
 * continuous document for keyboard navigation. */
function ProseBlock({
  markdown,
  onChange,
  mode = "editing",
  groupId,
}: {
  markdown: string;
  onChange: (v: string) => void;
  mode?: "editing" | "interacting";
  groupId?: string;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <OxEditor mode={mode} markdown={markdown} onChange={onChange} groupId={groupId} />
    </div>
  );
}

type CardState = {
  id: string;
  project: string;
  markdown: string;
  attachments: string[];
};

/** Reserves the SAME `41px` left gutter `.ox-content` uses for heading/list
 * markers (`--ox-grid`, set by the `.ox-tokens` class) — so a marker glyph
 * passed here hangs in that band exactly like `#`/`##`/`-` do elsewhere,
 * and `children` text always starts flush with the card's own OxEditor
 * body text below it. `marker` is optional — most rows here have none
 * (per the drawing, the card title itself carries no icon), but the slot
 * stays available for the day a real markdown heading marker is wired up. */
function GutterRow({
  marker,
  children,
}: {
  marker?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", paddingLeft: "var(--ox-grid, 41px)" }}>
      {marker != null && (
        <span
          aria-hidden
          className="subtle-text"
          style={{
            position: "absolute",
            left: 0,
            width: "32px",
            textAlign: "right",
            paddingRight: "6px",
            fontFamily: "ui-monospace, SF Mono, monospace",
            fontSize: "12px",
          }}
        >
          {marker}
        </span>
      )}
      {children}
    </div>
  );
}

/** A small placeholder thumbnail standing in for a real attachment preview,
 * with its footnote-style index badged in the corner. */
function AttachmentThumb({ index, name }: { index: number; name: string }) {
  return (
    <div
      className="dlv2-thumb"
      title={name}
      style={{
        position: "relative",
        width: "72px",
        height: "34px",
        borderRadius: "4px",
        flexShrink: 0,
      }}
    >
      <span
        className="dlv2-thumb-badge"
        style={{
          position: "absolute",
          right: "3px",
          bottom: "3px",
          fontSize: "10px",
          fontFamily: "monospace",
          padding: "1px 4px",
          borderRadius: "3px",
        }}
      >
        {index})
      </span>
    </div>
  );
}

/** Round "add" trigger — the same `CircleButton` + SVG plus-icon shown in
 * the design system (`fruits_.styles.tsx`, "Any SVG works"), at its normal
 * default size. Only the color changes, via `.circle-btn-green`
 * (root.css), so this reads as a solid affordance at rest instead of
 * `CircleButton`'s default transparent/hover-tinted look. */
function AddAttachmentButton({ onClick }: { onClick: () => void }) {
  return (
    <CircleButton
      className="circle-btn-green"
      onClick={onClick}
      aria-label="Attach file"
    >
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
  );
}

/** A card: `good-box` colors (warm `farground` fill, themed border — same
 * tokens the rest of the app already uses for a "box", nothing
 * card-specific), bled outward past its `DayContainer` on both sides via a
 * negative margin, with an equal inward padding that exactly cancels it —
 * so the card visually "sits on top of" the day's frame while its own text
 * still lands on the exact same column as everything else. */
 const CARD_BLEED = 8;
 const GUTTER = 41; // matches --ox-grid — the day container's own right inset

 function CardBox({
   card,
   onChangeMarkdown,
   onAttach,
   editable = true,
   groupId,
 }: {
   card: CardState;
   onChangeMarkdown: (v: string) => void;
   onAttach?: () => void;
   editable?: boolean;
   groupId?: string;
 }) {
   return (
     <div
       className="good-box ox-tokens"
       style={{
         marginLeft: `-${CARD_BLEED}px`,
         marginRight: `-${GUTTER + CARD_BLEED}px`,
         padding: `${CARD_BLEED}px ${GUTTER + CARD_BLEED}px ${CARD_BLEED}px ${CARD_BLEED}px`,
         marginBottom: "16px",
       }}
     >
      <div
        style={{
          borderBottom: "1px solid var(--midground)",
          paddingBottom: "10px",
          marginBottom: "12px",
        }}
      >
        <GutterRow>
          <span className="font-bold purple-light-text truncate">{card.project}</span>{" "}
          <a
            href="#"
            className="text-xs subtle-text"
            style={{ textDecoration: "underline", whiteSpace: "nowrap" }}
            onClick={(e) => e.preventDefault()}
          >
            open project →
          </a>
        </GutterRow>
      </div>

      <OxEditor
        mode={editable ? "editing" : "interacting"}
        markdown={card.markdown}
        onChange={onChangeMarkdown}
        groupId={groupId}
      />

      {(card.attachments.length > 0 || editable) && (
        <div
          style={{
            borderTop: "1px dashed var(--midground)",
            marginTop: "14px",
            paddingTop: "10px",
          }}
        >
          <GutterRow>
            <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
              {card.attachments.map((name, i) => (
                <AttachmentThumb key={name} index={i + 1} name={name} />
              ))}
              {editable && <AddAttachmentButton onClick={onAttach!} />}
            </div>
          </GutterRow>
        </div>
      )}
    </div>
  );
}

// ─── Add Card ───────────────────────────────────────────────────────────────
// Always-visible list of available projects (folder selections), not a
// click-to-reveal button — one fewer step, and every option is visible at
// a glance instead of hidden behind a "which project?" prompt. Only
// projects WITHOUT an existing card today are offered (enforces
// one-card-per-project-per-day). Left-gutter-aligned (`--ox-grid`) like
// every other hand-rolled row, so its text lands on the same column as
// the day's prose/card text. A real `/card` slash command would trigger
// the exact same `onCreate` from the cursor position instead of a chip
// click; nothing about how a card renders would change.

const MOCK_PROJECTS = ["Sunny", "Crouch", "Ridgeline", "Downtown Lofts"];

function AddCardSection({
  existingProjects,
  onCreate,
}: {
  existingProjects: string[];
  onCreate: (project: string) => void;
}) {
  const available = MOCK_PROJECTS.filter((p) => !existingProjects.includes(p));

  return (
    <div style={{ paddingLeft: "var(--ox-grid, 41px)", marginBottom: "16px" }}>
      <div
        className="subtle-text"
        style={{
          fontFamily: "monospace",
          fontSize: "10px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "8px",
        }}
      >
        Add a card
      </div>
      <div className="flex flex-wrap gap-2">
        {available.length === 0 ? (
          <span className="text-sm subtle-text">
            Every project already has a card today.
          </span>
        ) : (
          available.map((p) => (
            <Chip key={p} onClick={() => onCreate(p)}>
              {p}
            </Chip>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Release Log ────────────────────────────────────────────────────────────
// Plain monospace text, grouped by project — meant to read like a
// traditional changelog, not another styled UI widget. Each line names
// exactly where something ended up; nested lines are follow-on effects of
// the line above them (e.g. a rename cascading into every file that
// referenced the old name).

// Each line mirrors the real markdown that will land in `release-log.md`:
// a short description ending in a link whose visible text is the path
// relative to the current project folder, e.g.
// `- fence-line.jpg file put in [./gallery/fence-line.jpg](/projects/sunny/gallery/fence-line.jpg)`.
// Here it's rendered as an actual link (relativePath as the visible,
// underlined text) rather than showing the raw brackets — shorter and
// easier to scan than a separate trailing "[View]".
type ReleaseChange = {
  text: string;
  relativePath: string;
  href: string;
  children?: ReleaseChange[];
};

type ProjectReleaseLog = {
  project: string;
  projectHref: string;
  changes: ReleaseChange[];
};

function ReleaseLogLine({ change, depth }: { change: ReleaseChange; depth: number }) {
  return (
    <>
      <div style={{ paddingLeft: `${depth * 20}px` }}>
        {"- "}
        {change.text}{" "}
        <a
          href={change.href}
          onClick={(e) => e.preventDefault()}
          style={{ textDecoration: "underline" }}
        >
          {change.relativePath}
        </a>
      </div>
      {change.children?.map((child, i) => (
        <ReleaseLogLine key={i} change={child} depth={depth + 1} />
      ))}
    </>
  );
}

function ReleaseLogSection({
  groups,
  emptyHint,
}: {
  groups: ProjectReleaseLog[];
  emptyHint: string;
}) {
  const [open, setOpen] = useState(groups.length > 0);

  return (
    <div style={{ paddingLeft: "var(--ox-grid, 41px)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
        className="font-mono text-xs subtle-text"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Release Log
        </span>
      </button>

      {open && (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "13px",
            lineHeight: 1.7,
            marginTop: "10px",
            paddingTop: "10px",
            borderTop: "1px solid var(--midground)",
          }}
        >
          {groups.length === 0 ? (
            <div className="subtle-text">{emptyHint}</div>
          ) : (
            groups.map((group, gi) => (
              <div key={group.project} style={{ marginBottom: gi < groups.length - 1 ? "16px" : 0 }}>
                <div className="font-bold" style={{ marginBottom: "4px" }}>
                  {"### "}
                  {group.project}{" "}
                  <a
                    href={group.projectHref}
                    onClick={(e) => e.preventDefault()}
                    className="subtle-text"
                    style={{ textDecoration: "underline", fontWeight: "normal" }}
                  >
                    (open project)
                  </a>
                </div>
                {group.changes.map((change, i) => (
                  <ReleaseLogLine key={i} change={change} depth={0} />
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function DailyLogV2Mockup() {
  useLoaderData<typeof loader>();

  const [todayIntro, setTodayIntro] = useState(
    "Today\nI made a coffee and reviewed my tasks.",
  );
  const [todayCards, setTodayCards] = useState<CardState[]>([
    {
      id: "sunny",
      project: "Sunny",
      markdown:
        "Here I needed to clean up the site after a storm came through last night. It is now organized.\n\n- [x] Clear debris from driveway\n- [ ] Call insurance about the fence",
      attachments: ["driveway-after.jpg", "fence-before.jpg", "receipt.jpg"],
    },
    {
      id: "crouch",
      project: "Crouch",
      markdown:
        "Here I also needed to clean up from storm damage.\n\n- [ ] Get quote for new gutter",
      attachments: [],
    },
  ]);

  const [pastIntro] = useState(
    "Yesterday\nSlow morning, mostly caught up on email before heading out.",
  );
  const pastCard: CardState = {
    id: "sunny-past",
    project: "Sunny",
    markdown:
      "Walked the site with the contractor.\n\n- [x] Confirm delivery window\n- [x] Photograph existing fence line",
    attachments: ["fence-line.jpg", "contractor-notes.pdf"],
  };

  const pastReleaseLog: ProjectReleaseLog[] = [
    {
      project: "Sunny",
      projectHref: "#",
      changes: [
        {
          text: "fence-line.jpg file put in",
          relativePath: "./gallery/fence-line.jpg",
          href: "/projects/sunny/gallery/fence-line.jpg",
        },
        {
          text: "contractor-notes.pdf file put in",
          relativePath: "./documents/contractor-notes.pdf",
          href: "/projects/sunny/documents/contractor-notes.pdf",
        },
        {
          text: "Confirm delivery window task added in",
          relativePath: "./scope.md",
          href: "/projects/sunny/scope.md",
          children: [
            {
              text: "Referenced in",
              relativePath: "./readme.md",
              href: "/projects/sunny/readme.md",
            },
          ],
        },
        {
          text: "Renamed project to Sunny from Foothill, updated",
          relativePath: "./readme.md",
          href: "/projects/sunny/readme.md",
          children: [
            {
              text: "Updated 13 markdown files referencing the old name, browse",
              relativePath: "./",
              href: "/projects/sunny",
            },
          ],
        },
      ],
    },
    {
      project: "Crouch",
      projectHref: "#",
      changes: [
        {
          text: "Gutter quote request noted in",
          relativePath: "./scope.md",
          href: "/projects/crouch/scope.md",
        },
        {
          text: "Storm damage summary added to",
          relativePath: "./notes/2026-07-22.md",
          href: "/projects/crouch/notes/2026-07-22.md",
          children: [
            {
              text: "Referenced in",
              relativePath: "./readme.md",
              href: "/projects/crouch/readme.md",
            },
          ],
        },
      ],
    },
  ];

  function attach(cardId: string) {
    mockFileCounter += 1;
    const names = ["photo", "receipt", "notes", "before", "after"];
    const name = `${names[mockFileCounter % names.length]}-${mockFileCounter}.jpg`;
    setTodayCards((cards) =>
      cards.map((c) => (c.id === cardId ? { ...c, attachments: [...c.attachments, name] } : c)),
    );
  }

  function createCard(project: string) {
    mockCardCounter += 1;
    setTodayCards((cards) => [
      ...cards,
      { id: `new-${mockCardCounter}`, project, markdown: "", attachments: [] },
    ]);
  }

  return (
    <AppLayout>
      <div style={{ padding: "32px 16px 100px", maxWidth: "680px", margin: "0 auto" }}>
        {/* Today */}
        <div style={{ marginBottom: "12px" }}>
          <span
            className="purple-light-text"
            style={{ fontFamily: "monospace", fontSize: "16px" }}
          >
            Today
          </span>
        </div>
        <DayContainer>
          <OxEditorGroup order={["today-intro", ...todayCards.map((c) => c.id)]}>
            <ProseBlock markdown={todayIntro} onChange={setTodayIntro} groupId="today-intro" />
            {todayCards.map((card) => (
              <CardBox
                key={card.id}
                card={card}
                onChangeMarkdown={(v) =>
                  setTodayCards((cards) =>
                    cards.map((c) => (c.id === card.id ? { ...c, markdown: v } : c)),
                  )
                }
                onAttach={() => attach(card.id)}
                groupId={card.id}
              />
            ))}
          </OxEditorGroup>
          <AddCardSection
            existingProjects={todayCards.map((c) => c.project)}
            onCreate={createCard}
          />
          <ReleaseLogSection groups={[]} emptyHint="Processed at the end of the day." />
        </DayContainer>

        {/* Yesterday */}
        <div style={{ marginBottom: "12px" }}>
          <div
            style={{
              fontFamily: "monospace",
              fontSize: "20px",
              fontWeight: 100,
              color: "var(--text-subtle)",
              borderBottom: "1px solid var(--midground)",
              marginBottom: "12px",
            }}
          >
            Yesterday
          </div>
        </div>
        <DayContainer>
          <ProseBlock markdown={pastIntro} onChange={() => {}} mode="interacting" />
          <CardBox card={pastCard} onChangeMarkdown={() => {}} editable={false} />
          <ReleaseLogSection
            groups={pastReleaseLog}
            emptyHint="Nothing was sorted from this day."
          />
        </DayContainer>
      </div>
    </AppLayout>
  );
}
