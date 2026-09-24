import { Link } from "react-router";
import { Chip } from "stamps/Chip";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import type { Dashboard, DashboardRow, SteepNote } from "robustness-core/data/dashboard.server";
import type { DailyLog, DailyLogCard } from "robustness-core/data/dailyLog.server";
import type { ProjectStatus } from "robustness-core/data/project.types";
import { steepLabel } from "robustness-core/data/steepScale";
import { SteepGauge } from "./SteepGauge";
import { TodayLog } from "./TodayLog";

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

function GuideRow({ row, showMeter }: { row: DashboardRow; showMeter: boolean }) {
  const daysLeft =
    row.status === "trashed" && row.statusAt
      ? Math.max(0, 30 - Math.floor((Date.now() - new Date(row.statusAt).getTime()) / 86_400_000))
      : null;
  return (
    <Surface className={sprinkles({ p: 4 })} data-project-row={row.id}>
      <Stack gap={2}>
        <Cluster gap={3} style={{ justifyContent: "space-between" }}>
          <Link
            to={`/newspaper/${row.id}`}
            prefetch="intent"
            className={`${textSize.sm} ${sprinkles({ fontWeight: "bold" })}`}
            style={plainLink}
          >
            {row.name}
          </Link>
          {daysLeft !== null && (
            <span className={`${textSize.xs} ${sprinkles({ whiteSpace: "nowrap" })}`} style={subtle}>
              Deletes in {daysLeft}d
            </span>
          )}
        </Cluster>
        {row.ask && <p className={textSize.sm}>{row.ask}</p>}
        {row.notes.map((note) => (
          <NoteLine key={`${note.who}-${note.date}`} note={note} />
        ))}
        {showMeter && row.canTap && <SteepGauge projectFolderId={row.id} mine={row.mine} size="compact" />}
      </Stack>
    </Surface>
  );
}

function ClientProject({ row }: { row: DashboardRow }) {
  return (
    <Stack gap={2} data-project-row={row.id}>
      <Link
        to={`/newspaper/${row.id}`}
        prefetch="intent"
        className={`${textSize.lg} ${sprinkles({ fontWeight: "bold" })}`}
        style={plainLink}
      >
        {row.name}
      </Link>
      {row.read && <p className={textSize.sm}>{row.read}</p>}
    </Stack>
  );
}

function GuideProjects({
  rows,
  activeStatus,
  counts,
  topMeter,
}: {
  rows: DashboardRow[];
  activeStatus: ProjectStatus;
  counts: Record<ProjectStatus, number>;
  topMeter: boolean;
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
          Trashed projects are permanently deleted 30 days after being trashed.
        </p>
      )}
      {rows.length === 0 ? (
        <p className={textSize.sm} style={subtle}>
          {EMPTY_MESSAGE[activeStatus]}
        </p>
      ) : (
        <Stack gap={3}>
          {rows.map((row) =>
            row.seat === "client" ? (
              <Surface key={row.id} className={sprinkles({ p: 4 })}>
                <ClientProject row={row} />
              </Surface>
            ) : (
              <GuideRow key={row.id} row={row} showMeter={!topMeter} />
            ),
          )}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * The dashboard's body, below the greeting: the ritual on top (the gauge,
 * then today's Daily Log, the same editor as the Daily Log page), then
 * what the system gives back. Takes only what the loader returned, so a
 * render test can hand it any seat.
 */
export function DashboardView({
  activeStatus,
  dashboard,
  log,
}: {
  activeStatus: ProjectStatus;
  dashboard: Dashboard;
  log: {
    entries: Pick<DailyLog, "date" | "content">[];
    cardsByDate: Record<string, DailyLogCard[]>;
    projectFolders: { id: string; name: string }[];
  };
}) {
  const topRow = dashboard.rows.find((r) => r.id === dashboard.topMeterProjectId) ?? null;
  return (
    <Stack gap={10}>
      {/* The ritual: today's log and one tap on the gauge. A client writes
          first and says how the terrain feels after; a guide on one
          project gets the gauge above the log. */}
      <Stack gap={6}>
        {topRow && dashboard.view !== "client" && <SteepGauge projectFolderId={topRow.id} mine={topRow.mine} />}
        <div data-log-box>
          <TodayLog entries={log.entries} cardsByDate={log.cardsByDate} projectFolders={log.projectFolders} />
        </div>
        {topRow && dashboard.view === "client" && <SteepGauge projectFolderId={topRow.id} mine={topRow.mine} />}
      </Stack>

      {dashboard.view === "client" ? (
        <Stack gap={8}>
          {dashboard.rows.map((row) => (
            <ClientProject key={row.id} row={row} />
          ))}
        </Stack>
      ) : (
        <GuideProjects
          rows={dashboard.rows}
          activeStatus={activeStatus}
          counts={dashboard.counts ?? { active: 0, completed: 0, trashed: 0 }}
          topMeter={!!topRow}
        />
      )}
    </Stack>
  );
}
