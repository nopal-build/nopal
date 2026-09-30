// app/routes/newspaper.$folderId.tsx
// The Project Newspaper — the rolled-up view of one project folder (under
// the `projects` vault root), driven by the manifest front matter on its
// README.md — see `app/data/project.types.ts` for the manifest grammar and
// `app/data/project.server.ts` for how it's resolved. See also the
// `project-newspaper` skill.
//
// Lives at `/newspaper/:folderId` — was previously
// `fruits_.projects.$folderId.tsx` (renamed once this became the project's
// single detail page, rather than living alongside a separate
// OxMarkdown-based prototype at a `.../newspaper` sub-path).
//
// Gated ONLY on the viewer's ACCESS to the folder (`canViewFolder` below) —
// never on whether the README happens to have valid manifest front matter
// yet. `resolveProjectManifest` never fails closed (see its own doc), so
// anyone who can view this folder always sees this route; there's no
// redirect-to-vault fallback to worry about missing here.
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { useCallback, useMemo, useState } from "react";
import { getUser } from "../modules/auth/auth.server";
import { canViewFolder } from "robustness-core/data/vault.types";
import { getFolderById, getReadmeFileForFolder } from "robustness-core/data/vault.server";
import { pageHash } from "robustness-core/data/pageBody.server";
import { listMarksOnPage, readableMark } from "robustness-core/data/graphLogMarks.server";
import { listSuggestions } from "robustness-core/data/suggestions.server";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
import { resolveProjectManifest } from "robustness-core/data/project.server";
import { getProjectStatus } from "robustness-core/data/projectStatus.server";
import { isIncompleteBannerText, splitFrontmatter, type ProjectStatus } from "robustness-core/data/project.types";
import { getProjectSharing, resolveRole } from "robustness-core/data/projectSharing.server";
import { loadProjectFiles, type ProjectFileRow } from "robustness-core/data/fileFolders.server";
import { FILING_KINDS } from "robustness-core/data/syncFiling.server";
import { listCardsForProject } from "robustness-core/data/dailyLog.server";
import { listSeedDays } from "robustness-core/data/seed.server";
import { loadBudget } from "robustness-core/data/budget.server";
import { BudgetView, type BudgetNames } from "../components/BudgetView";
import { getHumansById } from "robustness-core/data/humans.server";
import { firstName } from "robustness-core/data/humanNames";
import {
  PROJECT_TAB_LABELS,
  TAB_FOLDERS,
  resolveProjectTab,
  rowsForReader,
  tabsFor,
} from "robustness-core/data/projectView.server";
import { GROUPS, featuresOf, groupOf } from "robustness-core/data/features";
import { ownLatestReading } from "robustness-core/data/dashboard.server";
import { navFor } from "../data/nav.server";
import { SteepGauge } from "../components/SteepGauge";
import { AppLayout } from "../components/AppLayout";
import { CardTabs } from "../components/stamps-candidates/CardTabs";
import { PinnedCard, PinnedCardWall } from "../components/stamps-candidates/PinnedCard";
import OxRenderer from "../components/OxRenderer";
import { ProjectFilesView } from "../components/ProjectFilesView";
import { ProjectView } from "../components/ProjectView";
import type { MoveOptions, OxAnnotations } from "../oxmarkdown/marks";
import { sprinkles } from "stamps/sprinkles.css";
import { button } from "stamps/button.css";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const folderId = params.folderId;
  if (!folderId) throw new Response("Not found", { status: 404 });

  const folder = await getFolderById(folderId);
  if (!folder) throw new Response("Not found", { status: 404 });
  // A website is its markdown files, edited in the Vault; it has no
  // Efforts, graph or log (Austin, 2026-09-28).
  if (isWebsiteFolder(folder)) return redirect(`/vault?folder=${folder._id}`);

  // What this page shows is the viewer's group's features (`features.ts`).
  // Someone in the cache with no role on the list (a share from before
  // roles) reads as an Observer, as they did; a Client is never in the
  // cache and reaches the page through their features alone.
  const sharing = await getProjectSharing(folder);
  const own = sharing.find((e) => e.human === user._id);
  const role = own && groupOf(own.role) ? resolveRole(own.role) : null;
  const inCache = canViewFolder(user._id, folder);
  const features = role ? role.features : inCache ? featuresOf("Observer") : [];
  const allowed = tabsFor(features);
  const tab = resolveProjectTab(new URL(request.url).searchParams.get("tab"), allowed);
  if (!tab) throw new Response("Not found", { status: 404 });
  const base = `/newspaper/${folder._id}`;
  const tabs = allowed.map((key) => ({
    key,
    label: PROJECT_TAB_LABELS[key],
    to: key === allowed[0] ? base : `${base}?tab=${key}`,
  }));

  // Only the open tab's data: the files are about ten queries.
  const tabFolders = TAB_FOLDERS[tab] ?? null;
  const files: ProjectFileRow[] | null =
    tabFolders && folder.folder_type === "project-n02" ? rowsForReader(await loadProjectFiles(folder), features) : null;
  const logbook = tab === "logbook" ? await projectLogbook(folder) : null;
  // The Budget: a view under Costs for the `budget` feature (Guides).
  // A typed URL without the feature is refused like a tab; the link only
  // shows once a budget has been started (features.ts, `budget`).
  const budgetView = tab === "costs" && new URL(request.url).searchParams.get("view") === "budget";
  if (budgetView && !features.includes("budget")) throw new Response("Not found", { status: 404 });
  const budget = tab === "costs" && features.includes("budget") ? await loadBudget(folder._id) : null;
  const budgetNames: BudgetNames = {};
  if (budget) {
    const ids = [...new Set(budget.lines.flatMap((l) => l.history.map((h) => h.author_human_id)))];
    for (const h of await getHumansById(ids)) budgetNames[h._id] = firstName(h);
  }
  // Only a role on the list marks: /api/graphlog/marks refuses a share
  // from before roles, which reads as an Observer here (same as Steep).
  const canMark = !!role?.features.includes("marks");
  // Everyone on the project sees who else is on it, Clients included
  // (Austin, 2026-09-27). Changing it stays the Guide's.
  const people = await projectPeople(sharing);
  // Moving a passage, filing a file, confirming a cost (`features.ts`).
  const canEdit = features.includes("edit");
  // What someone without `feeds` writes waits for a Guide
  // (`suggestions.server.ts`): a Guide sees every one, the writer their own.
  const decides = features.includes("suggestions");
  const suggestionsFor = decides ? ("all" as const) : !features.includes("feeds") ? { authorHumanId: user._id } : undefined;
  const suggestions = tab === "suggestions" ? await listSuggestions(folder._id, decides ? undefined : user._id) : null;

  // Children/README belong to the folder's OWNER, not necessarily the viewer
  // (this folder may only be reachable because it's shared with them).
  const project = await resolveProjectManifest(folder.human_id, folder);

  // The pen. There is one page and no archive (Austin, 2026-09-21): a
  // mark sits beside its words while they are on the page, and an unread
  // one whose passage was rewritten re-anchors and says it is waiting.
  // See `graphLogMarks.server.ts`.
  const readme = await getReadmeFileForFolder(folder.human_id, folder._id);
  const livePageHash = pageHash(readme?.content ?? "");
  // A mark that asked for a move usually names the project it named ("this
  // belongs to Coronado"). Whoever can open that project reads the mark as
  // written; to everyone else the project's existence is not theirs to
  // learn (Austin, 2026-09-21), so they get the same placeholder the
  // graph gets. `moveDestFolderId` never leaves the server.
  const marks = !canMark ? [] : await Promise.all(
    (await listMarksOnPage(folder._id, readme?.content ?? "", suggestionsFor)).map(async (mark) => {
      const dest = mark.moveDestFolderId ? await getFolderById(mark.moveDestFolderId) : null;
      return readableMark(mark, !!dest && canViewFolder(user._id, dest));
    }),
  );

  return {
    // Every other route surfaces `user` in its own loader data for
    // `useUser()`/`permissions.isAdmin()` to find via `useMatches()` --
    // there's no shared root layout loader that provides it
    // centrally. Omitting it here was a real, confirmed bug: `AppLayout`'s
    // nav silently hid the Maker link (and anything else gated on
    // `isAdmin`) for an Admin/Super viewing this specific page, since
    // `useUser()` found no ancestor match with a `user` key and fell back
    // to `null`.
    user,
    folder,
    project,
    status: getProjectStatus(folder),
    // Status is the Guide's (see `projectStatus.server.ts`).
    canEditStatus: !!role?.guiding,
    canMark,
    canEdit,
    decides,
    suggestions,
    people,
    // The meter sits top left on the project, with the viewer's own
    // reading only (Austin, 2026-09-25).
    // Only a role on the list taps: /api/steep refuses a share from before
    // roles, which reads as an Observer here.
    steep: role?.features.includes("steepTap") && getProjectStatus(folder) === "active"
      ? { mine: await ownLatestReading(user._id, folder._id) }
      : null,
    // A client has no Vault: a photo opens as itself.
    openInVault: inCache,
    ...(await navFor(user._id)),
    livePageHash,
    viewerId: user._id,
    marks,
    tab,
    tabs,
    tabFolders,
    files,
    // Server values the files view needs, as data (never imported into
    // the component, which would pull a `.server` module into the bundle).
    fileKinds: FILING_KINDS.filter((k) => k !== "video"),
    logbook,
    budgetView,
    budget,
    budgetNames,
    canBudget: features.includes("budget"),
  };
}

type SuggestionRow = NonNullable<Awaited<ReturnType<typeof listSuggestions>>>[number];

const SUGGESTION_STATUS_WORDS: Record<SuggestionRow["status"], string> = {
  pending: "waiting for a Guide",
  taken: "taken into the project",
  passed: "passed",
};

/** What someone without `feeds` wrote, waiting for a Guide. A Guide sees
 * every one waiting and takes it (in as written, credited) or passes it;
 * the writer sees their own and where each stands. */
function SuggestionsView({
  projectFolderId,
  suggestions,
  decides,
  onChanged,
}: {
  projectFolderId: string;
  suggestions: SuggestionRow[];
  decides: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (s: SuggestionRow, verdict: "take" | "pass") => {
    setBusy(s.id);
    setError(null);
    try {
      const res = await fetch("/api/graphlog/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectFolderId, kind: s.kind, id: s.id, verdict }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "That didn't go through. Try again.");
        return;
      }
      onChanged();
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  if (suggestions.length === 0) {
    return (
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        {decides ? "Nothing waiting." : "Nothing yet. What you write waits here for a Guide."}
      </p>
    );
  }
  return (
    <Stack gap={4}>
      {error && (
        <p className={textSize.sm} style={{ color: semanticColors.textDanger }}>
          {error}
        </p>
      )}
      {suggestions.map((s) => (
        <PinnedCard key={`${s.kind}:${s.id}`} title={s.authorName} label={`${longDate(s.date)} · ${s.kind === "card" ? "Card" : "Note"}`} data-suggestion>
          <Stack gap={2}>
            {s.context && (
              <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                {s.context}
              </p>
            )}
            {s.kind === "card" ? <OxRenderer markdown={s.text} /> : <p className={textSize.sm}>{s.text}</p>}
            {decides && s.status === "pending" ? (
              <Cluster gap={2}>
                <button type="button" disabled={busy === s.id} className={button({ variant: "primary" })} onClick={() => decide(s, "take")}>
                  Take it
                </button>
                <button type="button" disabled={busy === s.id} className={button({ variant: "outline" })} onClick={() => decide(s, "pass")}>
                  Pass
                </button>
              </Cluster>
            ) : (
              <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                {SUGGESTION_STATUS_WORDS[s.status]}
              </span>
            )}
          </Stack>
        </PinnedCard>
      ))}
    </Stack>
  );
}

/** The project's people by name, Guides first, then by the features
 * list's order. A role name that isn't a group is nobody here. */
async function projectPeople(sharing: { human: string; role: string }[]) {
  const members = sharing.flatMap((e) => {
    const group = groupOf(e.role);
    return group ? [{ human: e.human, group }] : [];
  });
  const names = new Map(
    (await getHumansById(members.map((m) => m.human))).map((h) => [h._id, firstName(h)]),
  );
  return members
    .map((m) => ({ name: names.get(m.human) ?? "Someone", group: m.group }))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name));
}

/** Every Card written to the project, one per person per day, newest
 * day first. */
/** The Cards, and the seed days beside them: a seed day is nobody's Card
 * (Austin, 2026-09-29: "never as someone's daily log"), so it is pinned
 * under "Seed" with its own badge, where the groups that see logs see it. */
async function projectLogbook(folder: Parameters<typeof listSeedDays>[0]) {
  const cards = (await listCardsForProject(folder._id)).filter((c) => c.content.trim());
  const names = new Map(
    (await getHumansById([...new Set(cards.map((c) => c.humanId))])).map((h) => [h._id, firstName(h)]),
  );
  const seed = (await listSeedDays(folder)).map((s) => ({ fileId: s.fileId, who: "Seed", date: s.date, content: s.content, seeded: true }));
  return [
    ...cards.map((c) => ({ fileId: c.fileId, who: names.get(c.humanId) ?? "Someone", date: c.date, content: c.content, seeded: false })),
    ...seed,
  ].sort((a, b) => b.date.localeCompare(a.date) || Number(a.seeded) - Number(b.seeded) || a.who.localeCompare(b.who));
}

/** A seed day without its front matter: the sections as the seeder wrote
 * them, headings and all, so a reader sees whose words each group is. */
function seedDayBody(markdown: string): string {
  return splitFrontmatter(markdown).body.trim();
}

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** The writer's own calendar day, which is what a mark is dated with. */
function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ProjectStatusControl({
  folderId,
  status,
}: {
  folderId: string;
  status: ProjectStatus;
}) {
  const revalidator = useRevalidator();
  const [updating, setUpdating] = useState(false);

  const changeStatus = async (next: ProjectStatus) => {
    if (next === status) return;
    setUpdating(true);
    try {
      await fetch(`/api/vault/projects/${folderId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      revalidator.revalidate();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <select
      aria-label="Project status"
      value={status}
      disabled={updating}
      onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
      className="text-xs font-mono"
      style={{
        background: "var(--farground)",
        border: "1px solid var(--midground)",
        color: "inherit",
        borderRadius: "6px",
        padding: "3px 6px",
      }}
    >
      <option value="active">Active</option>
      <option value="completed">Completed</option>
      <option value="trashed">Trashed</option>
    </select>
  );
}

/** The Logbook: what each person wrote about this project, one card per
 * person per day, pinned into a scrapbook. Read-only; each person edits
 * their own on the Daily Log. */
function Logbook({ cards }: { cards: { fileId: string; who: string; date: string; content: string; seeded: boolean }[] }) {
  if (cards.length === 0) {
    return (
      <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
        No cards yet.
      </p>
    );
  }
  return (
    <PinnedCardWall>
      {cards.map((c) => (
        <PinnedCard key={c.fileId} title={c.who} label={c.seeded ? `${longDate(c.date)} · seeded history` : longDate(c.date)} data-logbook-card data-seeded={c.seeded || undefined}>
          <OxRenderer markdown={c.seeded ? seedDayBody(c.content) : c.content} />
        </PinnedCard>
      ))}
    </PinnedCardWall>
  );
}

export default function NewspaperRoute() {
  const { folder, project, status, canEditStatus, canMark, canEdit, decides, suggestions, people, steep, openInVault, home, livePageHash, viewerId, marks, tab, tabs, tabFolders, files, fileKinds, logbook, budgetView, budget, budgetNames, canBudget } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { manifest, body, galleryFolders } = project;
  const revalidator = useRevalidator();

  const onSend = useCallback(
    async (unitKey: string, text: string, markId?: string): Promise<string | null> => {
      try {
        // Rewriting one of your own that no run has read yet, or writing
        // a new one. See `api.graphlog.marks.$markId.tsx`.
        const res = markId
          ? await fetch(`/api/graphlog/marks/${markId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            })
          : await fetch("/api/graphlog/marks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectFolderId: folder._id, pageHash: livePageHash, unitKey, text, date: localDate() }),
            });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't save. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't save. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash, revalidator],
  );

  const onErase = useCallback(
    async (markId: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/graphlog/marks/${markId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete" }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't come back. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't come back. Check your connection and try again.";
      }
    },
    [revalidator],
  );

  const loadMoveOptions = useCallback(
    async (unitKey: string): Promise<MoveOptions | string> => {
      try {
        const params = new URLSearchParams({ projectFolderId: folder._id, pageHash: livePageHash, unitKey });
        const res = await fetch(`/api/graphlog/move-options?${params}`);
        const data = (await res.json().catch(() => ({}))) as MoveOptions & { error?: string };
        if (!res.ok) return data.error ?? "Couldn't look that up. Try again.";
        return data;
      } catch {
        return "Couldn't look that up. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash],
  );

  const onMove = useCallback(
    async (input: {
      unitKey: string;
      entryFileId: string;
      section: string | null;
      occurrence: number;
      destProjectFolderId: string;
      text: string;
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/graphlog/moves", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, projectFolderId: folder._id, pageHash: livePageHash, date: localDate() }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't file. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't file. Check your connection and try again.";
      }
    },
    [folder._id, livePageHash, revalidator],
  );

  const onMoveAction = useCallback(
    async (moveId: string, action: "confirm" | "undo"): Promise<string | null> => {
      try {
        const res = await fetch(`/api/graphlog/moves/${moveId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return data.error ?? "That didn't go through. Try again.";
        }
        revalidator.revalidate();
        return null;
      } catch {
        return "That didn't go through. Check your connection and try again.";
      }
    },
    [revalidator],
  );

  const annotations = useMemo<OxAnnotations>(
    () => ({
      viewerId,
      marks: marks.map((m) => ({
        id: m.id,
        unitKey: m.unitKey,
        authorHumanId: m.authorHumanId,
        authorName: m.authorName,
        date: m.date,
        text: m.text,
        waiting: m.waiting,
        suggestion: m.suggestion,
        moved: m.moved,
        move:
          m.moveId && m.moveStatus
            ? {
                id: m.moveId,
                status: m.moveStatus,
                canConfirm: m.moveAuthorHumanId === viewerId,
                canUndo: m.moveAuthorHumanId === viewerId || m.authorHumanId === viewerId,
              }
            : undefined,
      })),
      canMark,
      onSend: onSend,
      onErase: onErase,
      // No move for someone who marks and doesn't edit (an Observer).
      loadMoveOptions: canEdit ? loadMoveOptions : undefined,
      onMove: canEdit ? onMove : undefined,
      onMoveAction,
      skipParagraph: isIncompleteBannerText,
    }),
    [marks, canMark, canEdit, onSend, onErase, loadMoveOptions, onMove, onMoveAction, viewerId],
  );

  return (
    <AppLayout>
      <CenterContent maxWidth={1280}>
        <Stack gap={2} className={sprinkles({ mb: 8 })}>
          {home.plural && (
            <Link to="/" className={textSize.xs} style={{ color: semanticColors.textSubtle, textDecoration: "none" }}>
              ← My Projects
            </Link>
          )}
          {steep && <SteepGauge projectFolderId={folder._id} mine={steep.mine} size="compact" />}
          <Cluster gap={4} align="baseline" style={{ justifyContent: "space-between" }}>
            <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>
              {manifest.title ?? folder.name}
            </h1>
            {canEditStatus ? (
              <ProjectStatusControl folderId={folder._id} status={status} />
            ) : (
              <span className={`${textSize.xs} ${sprinkles({ textTransform: "capitalize" })}`} style={{ color: semanticColors.textSubtle }}>
                {status}
              </span>
            )}
          </Cluster>
          {people.length > 0 && (
            <p className={textSize.sm} data-project-people>
              {people.map((p, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  {p.name} <span style={{ color: semanticColors.textSubtle }}>{p.group}</span>
                </span>
              ))}
            </p>
          )}
        </Stack>
        <CardTabs tabs={tabs} active={tab} label="Project">
          {tab === "efforts" && (
            <ProjectView body={body} galleryFolders={galleryFolders} annotations={annotations} />
          )}
          {tab === "costs" && canBudget && (
            <p className={textSize.sm} style={{ marginBottom: 12 }}>
              {budgetView ? (
                <Link to={`/newspaper/${folder._id}?tab=costs`}>Receipts</Link>
              ) : budget ? (
                <Link to={`/newspaper/${folder._id}?tab=costs&view=budget`}>Budget</Link>
              ) : (
                <Link to={`/newspaper/${folder._id}?tab=costs&view=budget`}>Start a budget</Link>
              )}
            </p>
          )}
          {budgetView && (
            <BudgetView projectFolderId={folder._id} budget={budget} names={budgetNames} onChanged={() => revalidator.revalidate()} />
          )}
          {files && tabFolders && !budgetView && (
            <ProjectFilesView
              projectFolderId={folder._id}
              rows={files}
              folders={tabFolders}
              kinds={fileKinds}
              onOpen={(row) => (openInVault ? navigate(`/vault?file=${row.serveId}`) : window.open(row.urls.display, "_blank"))}
              onChanged={() => revalidator.revalidate()}
              canFile={canEdit}
            />
          )}
          {logbook && <Logbook cards={logbook} />}
          {suggestions && (
            <SuggestionsView
              projectFolderId={folder._id}
              suggestions={suggestions}
              decides={decides}
              onChanged={() => revalidator.revalidate()}
            />
          )}
        </CardTabs>
      </CenterContent>
    </AppLayout>
  );
}
