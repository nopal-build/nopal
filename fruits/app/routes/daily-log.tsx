import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  redirect,
  useLoaderData,
  useFetcher,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import { DayContainer, DayTitle } from "../components/DailyLogDay";
import OxEditor from "../components/OxEditor";
import {
  TodayLog,
  buildCardResolver,
  formatEntryDate,
  localDateString,
} from "../components/TodayLog";
import {
  getDailyLogs,
  saveDailyLog,
  workableSaveDailyLog,
  getDailyLogCards,
  createDailyLogCard,
  saveDailyLogCard,
  isOwnCard,
  holdCardForGuide,
  type DailyLog,
  type DailyLogCard,
} from "robustness-core/data/dailyLog.server";
import { getFolderById } from "robustness-core/data/vault.server";
import { isWebsiteFolder } from "robustness-core/data/vaultFolderTypes";
import { getProjectRole, listProjectsFor } from "robustness-core/data/projectSharing.server";
import { featuresOf } from "robustness-core/data/features";
import { navFor } from "../data/nav.server";
import { markOwnMutation } from "../hooks/useVaultEvents";

export const meta: MetaFunction = () => [{ title: "O.No · Daily Logs" }];

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  // Load all entries newest-first; 500 is a generous ceiling for any user
  const { entries } = await getDailyLogs(user._id, { limit: 500 });

  // Projects for "Add a card": every project whose group gets `dailyLog`
  // (a Client does; an Observer doesn't write to the project).
  const memberships = await listProjectsFor(user._id);
  const projectFolders = memberships.filter((m) => featuresOf(m.role).includes("dailyLog")).map((m) => m.folder);

  // Cards for each day that actually references one — a cheap substring
  // check up front so this stays proportional to real Card usage instead
  // of doing a real folder/file lookup for every one of up to 500 days
  // unconditionally (most days won't have any).
  const cardsByDate: Record<string, DailyLogCard[]> = {};
  await Promise.all(
    entries
      .filter((e) => e.content.includes("::card{"))
      .map(async (e) => {
        cardsByDate[e.date] = await getDailyLogCards(user._id, e.date);
      }),
  );

  return {
    user,
    entries,
    projectFolders: projectFolders.map((f) => ({ id: f._id, name: f.name })),
    cardsByDate,
    ...(await navFor(user._id, memberships)),
  };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return { error: "Not authenticated" };

  const ct = request.headers.get("content-type") ?? "";

  // ── JSON save ──────────────────────────────────────────────────────────────────────────────
  // ── JSON save ─────────────────────────────────────────────────────────────
  if (ct.includes("application/json")) {
    const body = await request.json();

    // Create (or, per `createDailyLogCard`'s own idempotency, reuse) a
    // project's Card for a day — a separate request shape (no `content`)
    // from the two content-save shapes below.
    if ("createCardForProject" in body) {
      const { date, createCardForProject } = body as {
        date?: string;
        createCardForProject?: string;
      };
      if (!date || !createCardForProject) return { error: "Invalid request" };
      // A Card is how anyone on a project writes to it: their group has
      // to get `dailyLog` there. Without `feeds` (an Observer) it waits
      // for a Guide (`suggestions.server.ts`). A website takes no Cards.
      const projectFolder = await getFolderById(createCardForProject);
      const features = projectFolder && !isWebsiteFolder(projectFolder) ? (await getProjectRole(projectFolder, user._id))?.features ?? [] : [];
      if (!features.includes("dailyLog")) {
        return { error: "You don't have access to that project" };
      }
      const card = await createDailyLogCard(user._id, date, createCardForProject, { suggestion: !features.includes("feeds") });
      return { success: true, card };
    }

    const { date, content, mode, cardFileId } = body as {
      date: string;
      content: string;
      mode?: string;
      cardFileId?: string;
    };
    if (!date || typeof content !== "string")
      return { error: "Invalid request" };

    // A Card's OWN content — always a flat overwrite, no md_version
    // snapshotting (see `saveDailyLogCard`'s own header) — distinct from
    // the day's own `readme.md` save below.
    if (cardFileId) {
      // Only one of this person's own Cards for that day. Without this,
      // any signed-in person could overwrite any file whose id they knew.
      const cards = await getDailyLogCards(user._id, date);
      if (!isOwnCard(cards, cardFileId)) {
        return { error: "Not found" };
      }
      // And only while they're still on its project with `dailyLog`: taken
      // off, their Card is emptied (`removalScrap.server.ts`) and stays so.
      const card = cards.find((c) => c.fileId === cardFileId)!;
      const cardProject = await getFolderById(card.projectFolderId);
      const features = cardProject ? (await getProjectRole(cardProject, user._id))?.features ?? [] : [];
      if (!features.includes("dailyLog")) {
        return { error: "You're not writing to that project anymore." };
      }
      // Without `feeds` (an Observer) new words wait for a Guide, even on a
      // Card made before (`suggestions.server.ts`).
      if (!features.includes("feeds") && !card.suggestion) await holdCardForGuide(cardFileId, card.content);
      await saveDailyLogCard(cardFileId, content);
      return { success: true };
    }

    // workable mode — skip md_version snapshots for task check-offs etc.
    const { entry, fileId } =
      mode === "workable"
        ? await workableSaveDailyLog(user._id, date, content)
        : await saveDailyLog(user._id, date, content);
    return { success: true, entry, fileId };
  }

  // ── Multipart: form save ──────────────────────────────────────────────────
  const form = await request.formData();
  const date = String(form.get("date") ?? "");
  const content = String(form.get("content") ?? "");
  if (!date || typeof content !== "string") return { error: "Invalid request" };
  const { entry, fileId } = await saveDailyLog(user._id, date, content);
  return { success: true, entry, fileId };
}

// ─── PastLogEntry ───────────────────────────────────────────────────
// Read-mostly: main content is static prose, task checkboxes stay
// interactive (click to check off leftover items) — OxEditor's Interacting
// mode, the direct successor to the old Workable mode. Saves via
// `mode: "workable"` so ticking a box doesn't spam the version history.
// Cards behave the same way — a checkbox toggled inside a past day's card
// still saves, just without any version snapshotting (see
// `saveDailyLogCard`).

function PastLogEntry({
  entry,
  today,
  cards: initialCards,
}: {
  entry: DailyLog;
  today: string;
  cards: DailyLogCard[];
}) {
  const [content, setContent] = useState(entry.content);
  const [cards, setCards] = useState(initialCards);

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(entry.content);

  // This tab's own save — suppress the real-time echo for it, same as the
  // Today equivalent above.
  useEffect(() => {
    const data = saveFetcher.data;
    if (data && "success" in data && data.success && "fileId" in data) {
      markOwnMutation(data.fileId);
    }
  }, [saveFetcher.data]);

  // `entry`/`initialCards` are keyed by date only (see the `key={entry.date}`
  // in the parent), so React reuses this same instance across a revalidate
  // instead of remounting it — meaning fresh props DO reach an already-
  // mounted day, they just get ignored by `useState`'s one-time initializer
  // unless something explicitly pulls them in. Mirrors the Today reconciler
  // above, including the same `saveFetcher.state === "idle"` guard — without
  // it, a revalidate racing this tab's own in-flight save could read the
  // PRE-save content and reconcile back to it, which is the "add it, remove
  // it, re-add it" bug this closes off. Cards are ADDED only, never
  // overwritten/removed.
  const lastEntryRef = useRef(entry);
  useEffect(() => {
    if (entry === lastEntryRef.current) return;
    lastEntryRef.current = entry;
    if (
      saveFetcher.state === "idle" &&
      content === lastSavedRef.current &&
      entry.content !== content
    ) {
      setContent(entry.content);
      lastSavedRef.current = entry.content;
    }
  }, [entry, content, saveFetcher.state]);

  const lastInitialCardsRef = useRef(initialCards);
  useEffect(() => {
    if (initialCards === lastInitialCardsRef.current) return;
    lastInitialCardsRef.current = initialCards;
    setCards((cards) => {
      const known = new Set(cards.map((c) => c.fileId));
      const newOnes = initialCards.filter((c) => !known.has(c.fileId));
      return newOnes.length ? [...cards, ...newOnes] : cards;
    });
  }, [initialCards]);

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        if (newContent === lastSavedRef.current) return;
        lastSavedRef.current = newContent;
        saveFetcher.submit(
          { date: entry.date, content: newContent, mode: "workable" },
          {
            method: "POST",
            action: "/daily-log",
            encType: "application/json",
          },
        );
      }, 1500);
    },
    [entry.date, saveFetcher],
  );

  const cardSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const cardLastSaved = useRef<Record<string, string>>(
    Object.fromEntries(initialCards.map((c) => [c.fileId, c.content])),
  );
  const handleCardChange = useCallback(
    (fileId: string, newContent: string) => {
      setCards((cs) => cs.map((c) => (c.fileId === fileId ? { ...c, content: newContent } : c)));
      if (cardSaveTimers.current[fileId]) clearTimeout(cardSaveTimers.current[fileId]);
      cardSaveTimers.current[fileId] = setTimeout(() => {
        if (newContent === cardLastSaved.current[fileId]) return;
        cardLastSaved.current[fileId] = newContent;
        // A Card's content is its own `file_refs` row — suppress the
        // real-time echo for it, same as the Today page's `saveCardNow`.
        markOwnMutation(fileId);
        saveFetcher.submit(
          { date: entry.date, cardFileId: fileId, content: newContent },
          {
            method: "POST",
            action: "/daily-log",
            encType: "application/json",
          },
        );
      }, 1500);
    },
    [entry.date, saveFetcher],
  );

  const resolveCard = useMemo(
    () => buildCardResolver(cards, handleCardChange),
    [cards, handleCardChange],
  );

  return (
    <>
      <DayTitle className="subtle-text" style={{ fontWeight: 100 }}>
        {formatEntryDate(entry.date, today)}
      </DayTitle>
      <DayContainer>
        <OxEditor
          mode="interacting"
          markdown={content}
          onChange={handleChange}
          resolveCard={resolveCard}
          className="ox-card-host"
        />
      </DayContainer>
    </>
  );
}

// ─── ErrorBoundary ───────────────────────────────────────────────────────────

export function ErrorBoundary() {
  const error = useRouteError();

  let message = "Couldn't load Daily Log.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 401 || error.status === 403) {
      message = "Your session has expired.";
    } else {
      message = `Error ${error.status}: ${error.statusText}`;
    }
  } else if (error instanceof Error) {
    // iOS Safari reports network failures as "Load failed"
    if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError") ||
      error.message.includes("Load failed")
    ) {
      message =
        "Couldn't reach the server. Check your connection and try again.";
    } else {
      message = error.message;
    }
  }

  return (
    <AppLayout>
      <div
        style={{
          padding: "60px 16px",
          maxWidth: "480px",
          margin: "0 auto",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <p
          style={{
            fontFamily: "monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
          }}
        >
          Daily Log
        </p>
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-subtle)",
            lineHeight: "1.5",
          }}
        >
          {message}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </AppLayout>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyLogPage() {
  const { entries: serverEntries, projectFolders, cardsByDate } = useLoaderData<typeof loader>();

  // The device's own date, known only after hydration; until then every
  // entry renders as past on the server and the split is applied after.
  const [today, setToday] = useState("");
  useEffect(() => setToday(localDateString()), []);
  const pastEntries = today
    ? serverEntries.filter((e) => e.date !== today && e.content?.trim())
    : [];

  return (
    <AppLayout>
      <div
        style={{
          padding: "32px 16px 80px",
          maxWidth: "680px",
          margin: "0 auto",
        }}
      >
        {/* Today's editable entry, at the top of the page (see TodayLog). */}
        <TodayLog entries={serverEntries} cardsByDate={cardsByDate} projectFolders={projectFolders} />

        {/* Past entries: newest first — no extra wrapper spacing needed,
            `DayContainer`'s own `marginBottom` already separates every
            day consistently, Today included. */}
        {pastEntries.map((entry) => (
          <PastLogEntry
            key={entry.date}
            entry={entry}
            today={today}
            cards={cardsByDate[entry.date] ?? []}
          />
        ))}
      </div>
    </AppLayout>
  );
}
