import { Link } from "react-router";
import { Chip } from "stamps/Chip";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import type { Dashboard, DashboardRow, SteepNote } from "robustness-core/data/dashboard.server";
import type { ProjectStatus } from "robustness-core/data/project.types";
import { steepLabel } from "robustness-core/data/steepScale";

// ─── Rows ───────────────────────────────────────────────────────────────────

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

function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const subtle = { color: semanticColors.textSubtle } as const;
const plainLink = { color: "inherit", textDecoration: "none" } as const;

/** A client's reading, as a quiet line: who, where they are, where they
 * were. No colour, no icon, nothing that reads as an alarm. */
function NoteLine({ note }: { note: SteepNote }) {
  const was = note.previous && note.previous !== note.position ? `, was ${steepLabel(note.previous)}` : "";
  return (
    <p className={textSize.sm} style={subtle} data-steep-note>
      {note.who}: {steepLabel(note.position)} on {shortDate(note.date)}
      {was}
    </p>
  );
}

function GuideRow({ row }: { row: DashboardRow }) {
  const daysLeft =
    row.status === "trashed" && row.statusAt
      ? Math.max(0, 30 - Math.floor((Date.now() - new Date(row.statusAt).getTime()) / 86_400_000))
      : null;
  // The whole tile is the way in, not just its name (Austin, 2026-09-28).
  return (
    <Link to={`/newspaper/${row.id}`} prefetch="intent" style={{ ...plainLink, display: "block" }} data-project-row={row.id}>
      <Surface className={sprinkles({ p: 4 })}>
        <Stack gap={2}>
          <Cluster gap={3} style={{ justifyContent: "space-between" }}>
            <span className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>{row.name}</span>
            {daysLeft !== null && (
              <span className={`${textSize.xs} ${sprinkles({ whiteSpace: "nowrap" })}`} style={subtle}>
                Deletes in {daysLeft}d
              </span>
            )}
          </Cluster>
          {row.read && <p className={textSize.sm}>{row.read}</p>}
          {row.ask && <p className={textSize.sm} style={subtle}>{row.ask}</p>}
          {row.notes.map((note) => (
            <NoteLine key={`${note.who}-${note.date}`} note={note} />
          ))}
        </Stack>
      </Surface>
    </Link>
  );
}

/** A project where the viewer is a Client: a tile with its name, all of
 * it a way in (the page shows what the features list gives them). Their
 * meter is on the page. */
function OwnLogProject({ row }: { row: DashboardRow }) {
  return (
    <Link to={`/newspaper/${row.id}`} prefetch="intent" style={{ ...plainLink, display: "block" }} data-project-row={row.id}>
      <Surface className={sprinkles({ p: 4 })}>
        <span className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}>{row.name}</span>
      </Surface>
    </Link>
  );
}

/** Whether a row's role sees only its own log there (Client). */
function isOwnLogRow(row: DashboardRow): boolean {
  return row.role === "Client";
}

function GuideProjects({
  rows,
  activeStatus,
  counts,
}: {
  rows: DashboardRow[];
  activeStatus: ProjectStatus;
  counts: Record<ProjectStatus, number>;
}) {
  return (
    <Stack gap={3}>
      <h2
        className={`${textSize.sm} ${sprinkles({ fontWeight: "bold", textTransform: "uppercase", letterSpacing: "wider" })}`}
        style={subtle}
      >
        Projects
      </h2>
      <Cluster gap={2}>
        {STATUS_TABS.map((tab) => (
          <Link key={tab.key} to={tab.key === "active" ? "/" : `/?status=${tab.key}`} style={{ textDecoration: "none" }}>
            <Chip active={activeStatus === tab.key}>
              {tab.label} ({counts[tab.key]})
            </Chip>
          </Link>
        ))}
      </Cluster>
      {activeStatus === "trashed" && rows.length > 0 && (
        <p className={textSize.xs} style={subtle}>
          Trashed projects are deleted after 30 days.
        </p>
      )}
      {rows.length === 0 ? (
        <p className={textSize.sm} style={subtle}>
          {EMPTY_MESSAGE[activeStatus]}
        </p>
      ) : (
        <Stack gap={3}>
          {rows.map((row) =>
            isOwnLogRow(row) ? (
              <OwnLogProject key={row.id} row={row} />
            ) : (
              <GuideRow key={row.id} row={row} />
            ),
          )}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * My Projects: projects, and only projects (Austin, 2026-09-28). The daily
 * log lives on the Daily Log page and the Steep-o-meter on each project's
 * page. Takes only what the loader returned, so a render test can hand it
 * any view.
 */
export function DashboardView({ activeStatus, dashboard }: { activeStatus: ProjectStatus; dashboard: Dashboard }) {
  // Someone whose every role is Client (ADR-023): their projects, each a
  // way in, and nothing that counts.
  if (dashboard.view === "client") {
    return (
      <Stack gap={4}>
        {dashboard.rows.map((row) => (
          <OwnLogProject key={row.id} row={row} />
        ))}
      </Stack>
    );
  }
  return (
    <GuideProjects
      rows={dashboard.rows}
      activeStatus={activeStatus}
      counts={dashboard.counts ?? { active: 0, completed: 0, trashed: 0 }}
    />
  );
}
