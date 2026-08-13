// app/routes/fruits.tsx
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { Badge } from "../components/Badge";
import { Chip } from "../components/Chip";
import { MoreMenu } from "../components/MoreMenu";
import { DayContainer, DayTitle } from "../components/DailyLogDay";
import OxRenderer from "../components/OxRenderer";
import { getAccessibleProjectFolders } from "robustness-core/data/vault.server";
import type { VaultFolder } from "robustness-core/data/vault.types";
import { getDailyLogs, getDailyLogCards, type DailyLogCard } from "robustness-core/data/dailyLog.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";
import {
  DEFAULT_PROJECT_STATUS,
  PROJECT_STATUSES,
  type ProjectStatus,
} from "robustness-core/data/project.types";
import type { CardResolver } from "oxmarkdown-core";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const activeStatus: ProjectStatus = PROJECT_STATUSES.includes(
    statusParam as ProjectStatus,
  )
    ? (statusParam as ProjectStatus)
    : DEFAULT_PROJECT_STATUS;

  // Own projects PLUS anything someone else has shared a Sharing Role
  // with the user on (any role) — same superset the Daily Log's Cards
  // feature already uses (see the `vault` skill's Data model section).
  const allProjects: VaultFolder[] = await getAccessibleProjectFolders(user._id);

  const counts: Record<ProjectStatus, number> = {
    active: 0,
    completed: 0,
    trashed: 0,
  };
  for (const project of allProjects) counts[getProjectStatus(project)]++;

  const projects = allProjects
    .filter((project) => getProjectStatus(project) === activeStatus)
    .map((project) => ({
      _id: project._id,
      name: project.name,
      status: getProjectStatus(project),
      statusAt: project.project_status_at ?? null,
    }));

  // Most recent daily log entry, for the "keep writing" preview below —
  // whether it's actually TODAY's entry is resolved client-side (see
  // `DailyLogPreview`), since "today" is the user's own local date, not
  // anything the server can know.
  const { entries: latestEntries } = await getDailyLogs(user._id, { limit: 1 });
  const latestLog = latestEntries[0]
    ? { date: latestEntries[0].date, content: latestEntries[0].content }
    : null;

  // Cards live in SEPARATE vault files from the day's own readme (see the
  // `vault` skill's Daily Log section) — only fetched when the entry
  // actually references one, same cheap up-front check the real Daily Log
  // loader already uses.
  const latestLogCards =
    latestLog && latestLog.content.includes("::card{")
      ? await getDailyLogCards(user._id, latestLog.date)
      : [];

  return { user, activeStatus, counts, projects, latestLog, latestLogCards };
}

// ─── App status ─────────────────────────────────────────────────────────────

function AppStatusMenu() {
  return (
    <MoreMenu
      label="App status"
      trigger={({ toggle, open }) => (
        <Chip active={open} onClick={toggle} className="whitespace-nowrap">
          App Status: In Development
        </Chip>
      )}
    >
      {() => (
        <div style={{ width: "320px", padding: "10px 12px" }}>
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="warning">In Development</Badge>
            <span className="font-bold text-sm">Nopal is under active development</span>
          </div>
          <p className="text-sm subtle-text mb-3">
            This app seeks to answer the question &ldquo;how much project
            management can be done entirely by letting you journal about
            your day?&rdquo;
          </p>
          <p className="text-sm subtle-text mb-3">
            If you have feedback, please reach out to me directly at{" "}
            <a
              href="mailto:gerald@nopal.build"
              className="underline"
              style={{ color: "inherit" }}
            >
              gerald@nopal.build
            </a>
          </p>
          <p className="text-sm subtle-text mb-3">
            Cheers,
            <br />
            -Gerald, Nopal Co-Founder and Engineer
          </p>

          <hr style={{ borderColor: "currentColor", opacity: 0.12, margin: "4px 0 10px" }} />

          <details>
            <summary className="text-sm font-bold cursor-pointer select-none">
              Current Detailed Status
            </summary>
            <ul className="mt-3 text-sm subtle-text space-y-2">
              <li className="flex items-center gap-2">
                <Badge variant="danger">Unstable</Badge>
                <span>Projects: Rework in progress.</span>
              </li>
            </ul>
            <ul className="mt-4 text-sm subtle-text space-y-2">
              <li className="flex items-center gap-2">
                <Badge variant="success">Stable</Badge>
                <span>Daily Logs: Journal on!</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="success">Stable</Badge>
                <span>Profile</span>
              </li>
              <li className="flex items-center gap-2">
                <Badge variant="success">Stable</Badge>
                <span>Security: You're safe</span>
              </li>
            </ul>
          </details>
        </div>
      )}
    </MoreMenu>
  );
}

// ─── Daily Log preview ──────────────────────────────────────────────────────

function localDateString(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** A read-only `CardResolver` for the dashboard preview — same shape
 * `fruits_.daily-log.tsx`'s own `buildCardResolver` builds, minus the
 * save wiring (`onChange` is never actually invoked: `OxRenderer` below
 * is rendered with no `interactive`, so a `::card{...}` renders through
 * the plain static path, not a live editable one — see `OxRenderer`'s
 * `CardDirectiveStatic`). */
function buildReadOnlyCardResolver(cards: DailyLogCard[]): CardResolver {
  return (fileName) => {
    const card = cards.find((c) => c.fileName === fileName);
    if (!card) return undefined;
    return {
      projectName: card.projectName,
      projectHref: `/fruits/vault?folder=${card.projectFolderId}`,
      markdown: card.content,
      onChange: () => {},
    };
  };
}

function DailyLogPreview({
  latestLog,
  latestLogCards,
}: {
  latestLog: { date: string; content: string } | null;
  latestLogCards: DailyLogCard[];
}) {
  // Starts unresolved so server/client markup matches on first paint (no
  // hydration mismatch) — the real device date is only known after mount,
  // same technique the Daily Log page itself uses for "today".
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(localDateString()), []);

  const hasToday =
    today !== null && latestLog?.date === today && latestLog.content.trim().length > 0;

  const resolveCard = useMemo(
    () => buildReadOnlyCardResolver(latestLogCards),
    [latestLogCards],
  );

  return (
    <div className="mb-10">
      <DayTitle className="purple-light-text">Daily Log</DayTitle>

      {today === null ? (
        <DayContainer>
          <p className="text-sm subtle-text" style={{ padding: "0 var(--ox-grid, 41px)" }}>
            &nbsp;
          </p>
        </DayContainer>
      ) : hasToday ? (
        <>
          {/* The white "day frame" holds ONLY the clipped/faded preview —
              the real entry's prose AND cards, rendered through the same
              OxMarkdown renderer the Daily Log page itself uses (same
              `.daily-log-day` frame, identical spacing) — not the "Keep
              writing" action, which sits below it as a plain divider (see
              `.daily-log-fade-footer`). Hand-rolled instead of
              `DayContainer` since that component's own hardcoded 64px
              bottom margin would push the footer well below the frame
              instead of right beneath it. Square bottom corners
              (`daily-log-day--hard-cut`) and no bottom padding — the
              frame ends right where the content is cut, not with extra
              breathing room after it. */}
          <div
            className="daily-log-day daily-log-day--hard-cut ox-tokens"
            style={{ padding: "24px 0 0" }}
          >
            <OxRenderer
              markdown={latestLog!.content}
              resolveCard={resolveCard}
              className="daily-log-fade ox-card-host"
            />
          </div>
          <div className="daily-log-fade-footer">
            <Link
              to="/fruits/daily-log"
              className="btn-primary text-sm inline-block"
              style={{ textDecoration: "none" }}
            >
              Keep writing →
            </Link>
          </div>
        </>
      ) : (
        <DayContainer>
          <div style={{ padding: "0 var(--ox-grid, 41px)" }}>
            <p className="text-sm subtle-text mb-4">
              You haven&rsquo;t written anything today yet. What&rsquo;s on your mind?
            </p>
            <Link
              to="/fruits/daily-log"
              className="btn-primary text-sm inline-block"
              style={{ textDecoration: "none" }}
            >
              Add today&rsquo;s thoughts →
            </Link>
          </div>
        </DayContainer>
      )}
    </div>
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

const STATUS_TABS: { key: ProjectStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "trashed", label: "Trashed" },
];

const EMPTY_MESSAGE: Record<ProjectStatus, string> = {
  active: "No active projects yet.",
  completed: "No completed projects yet.",
  trashed: "Nothing in the trash.",
};

type ProjectRowData = {
  _id: string;
  name: string;
  status: ProjectStatus;
  statusAt: string | null;
};

function ProjectRow({ project }: { project: ProjectRowData }) {
  const daysLeft =
    project.status === "trashed" && project.statusAt
      ? Math.max(
          0,
          30 - Math.floor((Date.now() - new Date(project.statusAt).getTime()) / 86_400_000),
        )
      : null;

  return (
    <Link
      to={`/fruits/newspaper/${project._id}`}
      prefetch="intent"
      className="good-box p-4 flex items-center justify-between gap-3 hover:opacity-80 transition-opacity"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <span className="font-bold text-sm">{project.name}</span>
      {daysLeft !== null && (
        <span className="text-xs subtle-text whitespace-nowrap shrink-0">
          Deletes in {daysLeft}d
        </span>
      )}
    </Link>
  );
}

function ProjectsSection({
  projects,
  activeStatus,
  counts,
}: {
  projects: ProjectRowData[];
  activeStatus: ProjectStatus;
  counts: Record<ProjectStatus, number>;
}) {
  return (
    <div>
      <h2 className="font-bold text-sm mb-3 subtle-text uppercase tracking-wide">
        Projects
      </h2>

      <div className="flex gap-2 mb-4">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.key}
            to={tab.key === "active" ? "/fruits" : `/fruits?status=${tab.key}`}
            style={{ textDecoration: "none" }}
          >
            <Chip active={activeStatus === tab.key}>
              {tab.label} ({counts[tab.key]})
            </Chip>
          </Link>
        ))}
      </div>

      {activeStatus === "trashed" && projects.length > 0 && (
        <p className="text-xs subtle-text mb-3">
          Trashed projects are permanently deleted 30 days after being trashed.
        </p>
      )}

      {projects.length === 0 ? (
        <p className="text-sm subtle-text">{EMPTY_MESSAGE[activeStatus]}</p>
      ) : (
        <div className="flex flex-col gap-3" style={{ maxWidth: "480px" }}>
          {projects.map((project) => (
            <ProjectRow key={project._id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Fruits() {
  const { user, activeStatus, counts, projects, latestLog, latestLogCards } =
    useLoaderData<typeof loader>();

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12">
        {/* Greeting */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-2xl mb-1">
              Hello, {user.name ?? user.email}
            </h1>
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              Welcome back.
            </p>
          </div>
          <AppStatusMenu />
        </div>

        {/* Daily Log */}
        <DailyLogPreview latestLog={latestLog} latestLogCards={latestLogCards} />

        {/* Projects */}
        <ProjectsSection projects={projects} activeStatus={activeStatus} counts={counts} />
      </div>
    </AppLayout>
  );
}
