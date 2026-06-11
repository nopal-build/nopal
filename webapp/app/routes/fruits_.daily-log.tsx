import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  LinksFunction,
} from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { getUser } from "../modules/auth/auth.server";
import { AppLayout } from "../components/AppLayout";
import {
  getDailyLogs,
  saveDailyLog,
  type DailyLog,
} from "../data/dailyLog.server";

import { useMarkdown } from "../hooks/useMarkdown";
import { resolveNopalMarkdown } from "../util/nopalMarkdown";
import projectStyles from "../styles/project.css?url";
import mdxEditorStyles from "../styles/mdxeditor.css?url";

// Lazy-load the MDX editor — client only, never runs on the server.
const MdxEditorClient = lazy(() => import("../components/MdxEditorClient"));

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: projectStyles },
  { rel: "stylesheet", href: mdxEditorStyles },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function localDateString(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatEntryDate(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const diff = Math.round((todayDate.getTime() - date.getTime()) / 86400000);
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function getPreview(
  content: string,
  lineCount = 10,
): { preview: string; hasMore: boolean } {
  const lines = content.split("\n");
  if (lines.length <= lineCount) return { preview: content, hasMore: false };
  return { preview: lines.slice(0, lineCount).join("\n"), hasMore: true };
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  // Load all entries newest-first; 500 is a generous ceiling for any user
  const { entries } = await getDailyLogs(user._id, { limit: 500 });
  return { user, entries };
}

// ─── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const user = await getUser(request);
  if (!user) return { error: "Not authenticated" };

  const ct = request.headers.get("content-type") ?? "";

  // ── JSON save ──────────────────────────────────────────────────────────────────
  if (ct.includes("application/json")) {
    const body = await request.json();
    const { date, content } = body;
    if (!date || typeof content !== "string")
      return { error: "Invalid request" };
    const entry = await saveDailyLog(user._id, date, content);
    return { success: true, entry };
  }

  // ── Multipart: file upload OR form save ──────────────────────────────────
  const form = await request.formData();

  // ── Regular form save ─────────────────────────────────────────────────────────
  const date = String(form.get("date") ?? "");
  const content = String(form.get("content") ?? "");
  if (!date || typeof content !== "string") return { error: "Invalid request" };
  const entry = await saveDailyLog(user._id, date, content);
  return { success: true, entry };
}

// ─── Static intro content ─────────────────────────────────────────────────────

const INTRO_CONTENT = `Welcome to your daily log. This is a quiet place to capture what you're working on, what you're thinking about, and what's happening on your projects.

I use mine to record:
— Decisions and why I made them
— Blockers I ran into
— Things I want to follow up on
— Small wins worth writing down

The format is loose. Some days a few sentences, other days a few paragraphs. There's no wrong way to do it. The goal is just to have a record.

Your log stays open all day based on your device's clock and saves automatically as you type. Scroll up to see past entries.

— Gerald`;

// ─── Shared expand button ─────────────────────────────────────────────────────

function ExpandButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        fontSize: "0.8rem",
        color: "var(--purple-light)",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "6px 0 0 40px",
        fontFamily: "monospace",
        display: "block",
      }}
    >
      {expanded ? "Show less ↑" : "Show more ↓"}
    </button>
  );
}

// ─── AuthorIntroEntry ─────────────────────────────────────────────────────────

function AuthorIntroEntry() {
  const [expanded, setExpanded] = useState(false);
  const { preview, hasMore } = getPreview(INTRO_CONTENT, 10);

  return (
    <div
      style={{
        padding: "20px 24px",
        marginBottom: "80px",
        background: "var(--farground)",
        border: "1px dashed var(--midground)",
        borderRadius: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontFamily: "monospace",
            fontSize: "0.82rem",
            color: "var(--text-subtle)",
          }}
        >
          A note from the author
        </span>
        <span
          style={{
            background: "var(--yellow)",
            color: "var(--purple)",
            borderRadius: "4px",
            padding: "2px 6px",
            fontSize: "0.72rem",
            fontFamily: "monospace",
          }}
        >
          pinned
        </span>
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "inherit",
          fontSize: "0.93rem",
          lineHeight: "1.65",
          margin: "0",
          color: "var(--text-subtle)",
        }}
      >
        {expanded ? INTRO_CONTENT : preview}
      </pre>
      {hasMore && (
        <ExpandButton
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
        />
      )}
    </div>
  );
}

// ─── PastLogEntry ─────────────────────────────────────────────────────────────

function PastLogEntry({ entry, today }: { entry: DailyLog; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const resolved = resolveNopalMarkdown(entry.content);
  const { preview, hasMore } = getPreview(resolved, 10);
  const previewMd = useMarkdown(preview);
  const fullMd = useMarkdown(resolved);

  return (
    <div style={{ marginBottom: "80px" }}>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: "20px",
          fontWeight: "100",
          marginLeft: "40px",
          color: "var(--text-subtle)",
          borderBottom: "1px solid var(--midground)",
        }}
      >
        {formatEntryDate(entry.date, today)}
      </div>
      <div className="log-entry-content">{expanded ? fullMd : previewMd}</div>
      {hasMore && (
        <ExpandButton
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
        />
      )}
    </div>
  );
}

// ─── TodayLogEntry ────────────────────────────────────────────────────────────

function TodayLogEntry({
  date,
  today,
  content,
  onChange,
  onEditorMounted,
}: {
  date: string;
  today: string;
  content: string;
  onChange: (v: string) => void;
  onEditorMounted?: () => void;
}) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("source", "daily-log");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      throw new Error(err.error ?? `Upload failed: ${res.status}`);
    }
    const { url } = (await res.json()) as { url: string };
    return url;
  }, []);

  // Build "Today — Monday, November 15, 2024"
  const [y, m, d] = date.split("-").map(Number);
  const fullDate = new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dateLabel = formatEntryDate(date, today);
  const heading = dateLabel === "Today" ? `Today — ${fullDate}` : dateLabel;

  return (
    <div
      style={{
        marginBottom: "12px",
      }}
    >
      <div className="nopal-editor-sticky-header">
        <span
          className="purple-light-text"
          style={{
            fontFamily: "monospace",
            fontSize: "16px",
          }}
        >
          {heading}
        </span>
      </div>

      <div className="mdx-editor-wrapper">
        {isClient && date ? (
          <Suspense
            fallback={
              <div
                style={{
                  fontFamily: "inherit",
                  fontSize: "0.95rem",
                  color: "var(--subtle-text)",
                  padding: "8px 0 0 0",
                }}
              >
                Loading editor…
              </div>
            }
          >
            <MdxEditorClient
              key={date}
              markdown={content}
              onChange={onChange}
              uploadFile={uploadFile}
              onEditorReady={
                onEditorMounted ? () => onEditorMounted() : undefined
              }
            />
          </Suspense>
        ) : (
          <div
            style={{
              fontFamily: "inherit",
              fontSize: "0.95rem",
              color: "var(--subtle-text)",
              padding: "8px 0 0 0",
            }}
          >
            Loading editor…
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DailyLogPage() {
  const { user, entries: serverEntries } = useLoaderData<typeof loader>();

  // ── today + todayContent ──────────────────────────────────────────────────
  // Both start as "" so the server render and the initial client render
  // produce identical output (no hydration mismatch). The real device date
  // and server content are read in a single useEffect after hydration.

  const [today, setToday] = useState("");
  const [todayContent, setTodayContent] = useState("");

  useEffect(() => {
    const d = localDateString();
    setToday(d);

    const serverEntry = serverEntries.find((e) => e.date === d);
    if (serverEntry?.content) setTodayContent(serverEntry.content);
  }, []); // intentionally empty — run exactly once after hydration

  // ── Derived values (gated on today being resolved) ───────────────────────

  // While today === "" all entries render as past entries on the server;
  // after hydration the correct split is applied.
  const pastEntries = today
    ? serverEntries
        .filter((e) => e.date !== today)
        .slice()
        .reverse()
    : [];

  // ── Server save ───────────────────────────────────────────────────────────

  const saveFetcher = useFetcher<typeof action>();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveNow = useCallback(
    (content: string) => {
      if (!today) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveFetcher.submit(
        { date: today, content },
        {
          method: "POST",
          action: "/fruits/daily-log",
          encType: "application/json",
        },
      );
    },
    [today, saveFetcher],
  );

  const scheduleSave = useCallback(
    (content: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveNow(content), 2000);
    },
    [saveNow],
  );

  // Cancel any pending debounce on unmount
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const handleChange = useCallback(
    (content: string) => {
      setTodayContent(content);
      scheduleSave(content);
    },
    [today, scheduleSave],
  );

  // ── Scroll "Today" into view ────────────────────────────────────────────
  //
  // Two-pass scroll:
  //  1. First pass fires when `today` resolves — jumps the page to the today
  //     section immediately, even while the editor is still lazy-loading.
  //  2. Correction pass fires once MdxEditorClient has mounted and the browser
  //     has had one frame to lay out the full entry content. This corrects the
  //     scroll position for long existing entries whose lazy-loaded editor
  //     height was unknown at step 1.

  const todayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!today) return;
    todayRef.current?.scrollIntoView({
      behavior: "instant" as ScrollBehavior,
      block: "start",
    });
  }, [today]); // fires when today transitions from "" to the real date

  const handleEditorMounted = useCallback(() => {
    requestAnimationFrame(() => {
      todayRef.current?.scrollIntoView({
        behavior: "instant" as ScrollBehavior,
        block: "start",
      });
    });
  }, []);

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      <div
        style={{
          padding: "32px 16px 80px",
          maxWidth: "680px",
          margin: "0 auto",
        }}
      >
        <AuthorIntroEntry />

        {/* Past entries: oldest at top, newest just above today */}
        {pastEntries.map((entry) => (
          <PastLogEntry key={entry.date} entry={entry} today={today} />
        ))}

        {/* Today's editable entry — ref lets us scroll it to the top */}
        <div ref={todayRef}>
          <TodayLogEntry
            date={today}
            today={today}
            content={todayContent}
            onChange={handleChange}
            onEditorMounted={handleEditorMounted}
          />
        </div>
      </div>
    </AppLayout>
  );
}
