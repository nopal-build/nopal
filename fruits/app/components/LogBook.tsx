// app/components/LogBook.tsx
//
// A Camp's running journal — a reusable, two-pane entry browser: a left
// side for quick entry searching/picking, a right side showing the
// selected entry's full content. Sortable oldest↔newest, auto-scrolls
// the list to whatever's selected, lazy-loaded (capped at 10 to start,
// "Load more" reveals the next page). See
// `garden/3-growing/camps-and-log-books.md`.
//
// Presentation + its own client-side fetching: the caller supplies the
// already-loaded entry SUMMARIES (cheap — front matter only) via
// `entries`; this component fetches one entry's full detail (body +
// assets) itself, on selection, straight from the already-built
// `/api/vault/camps/:campFolderId/log/entries/:entryFolderId` JSON route
// — no `.server` import here, so it's safe in any client-rendered route,
// and it's genuinely reusable: a future call site just needs a
// `campFolderId` and a list of summaries, nothing else.
import { useEffect, useMemo, useRef, useState } from "react";
import { Surface } from "stamps/Surface";
import { Stack } from "stamps/Stack";
import { Cluster } from "stamps/Cluster";
import { SearchField } from "stamps/SearchField";
import { Input } from "stamps/Input";
import { button } from "stamps/button.css";
import { textSize } from "stamps/typography.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";

export type LogBookEntrySummary = {
  folderId: string;
  name: string;
  statement: string | null;
  /** Set once at creation, never changed. */
  entryDate: string | null;
  /** Bumped on every content edit. */
  editedDate: string | null;
};

type LogBookEntryDetail = LogBookEntrySummary & {
  body: string;
  assets: { name: string }[];
};

const PAGE_SIZE = 10;

export function LogBook({
  campFolderId,
  entries,
  canWrite = false,
  onEntryAdded,
}: {
  campFolderId: string;
  /** Every entry, oldest-first (what `listLogEntries` returns) — this
   * component handles sort direction, paging, and selection itself. */
  entries: LogBookEntrySummary[];
  /** Whether "Add entry" should be offered. */
  canWrite?: boolean;
  /** Called after a new entry is successfully added — the caller should
   * revalidate so `entries` picks up the new one. */
  onEntryAdded?: () => void;
}) {
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogBookEntryDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [newStatement, setNewStatement] = useState("");
  const [adding, setAdding] = useState(false);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const ordered = useMemo(() => {
    const sorted = [...entries];
    if (order === "newest") sorted.reverse();
    return sorted;
  }, [entries, order]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((e) => (e.statement ?? "").toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
  }, [ordered, query]);

  const visible = filtered.slice(0, visibleCount);

  // Default selection: whatever's first in the current sort order.
  useEffect(() => {
    if (ordered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !ordered.some((e) => e.folderId === selectedId)) {
      setSelectedId(ordered[0].folderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    fetch(`/api/vault/camps/${campFolderId}/log/entries/${selectedId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDetail(data.entry ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campFolderId, selectedId]);

  // Auto-scroll the selected row into view in the left list.
  useEffect(() => {
    if (!selectedId) return;
    itemRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function selectNext() {
    const idx = filtered.findIndex((e) => e.folderId === selectedId);
    const next = filtered[idx + 1];
    if (next) setSelectedId(next.folderId);
  }

  async function addEntry() {
    if (!newStatement.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/vault/camps/${campFolderId}/log/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement: newStatement.trim() }),
      });
      if (res.ok) {
        setNewStatement("");
        onEntryAdded?.();
      }
    } finally {
      setAdding(false);
    }
  }

  const borderStyle = `1px solid ${semanticColors.surfaceBorder}`;

  return (
    <Surface className={sprinkles({ p: 0 })} style={{ display: "flex", minHeight: 360, overflow: "hidden" }}>
      <Stack gap={0} style={{ width: 280, borderRight: borderStyle, flexShrink: 0 }}>
        <div className={sprinkles({ p: 3 })} style={{ borderBottom: borderStyle }}>
          <Stack gap={2}>
            <SearchField
              label="Search entries"
              name="q"
              placeholder="Search entries…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Cluster gap={2} align="center">
              <button
                type="button"
                className={`${button({ variant: order === "newest" ? "outline" : "quiet" })} ${textSize.xs}`}
                onClick={() => setOrder("newest")}
              >
                Newest first
              </button>
              <button
                type="button"
                className={`${button({ variant: order === "oldest" ? "outline" : "quiet" })} ${textSize.xs}`}
                onClick={() => setOrder("oldest")}
              >
                Oldest first
              </button>
            </Cluster>
          </Stack>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {visible.length === 0 ? (
            <p className={`${textSize.sm} ${sprinkles({ p: 3, m: 0 })}`} style={{ color: semanticColors.textSubtle }}>
              No entries yet.
            </p>
          ) : (
            visible.map((e) => (
              <button
                key={e.folderId}
                ref={(el) => {
                  if (el) itemRefs.current.set(e.folderId, el);
                  else itemRefs.current.delete(e.folderId);
                }}
                type="button"
                onClick={() => setSelectedId(e.folderId)}
                className={sprinkles({ display: "flex", p: 3 })}
                style={{
                  width: "100%",
                  textAlign: "left",
                  flexDirection: "column",
                  gap: 2,
                  border: "none",
                  borderBottom: borderStyle,
                  background: e.folderId === selectedId ? semanticColors.surfaceInset : "transparent",
                  cursor: "pointer",
                }}
              >
                <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                  {e.entryDate ?? "?"}
                </span>
                <span className={textSize.sm}>{(e.statement ?? e.name).slice(0, 80)}</span>
              </button>
            ))
          )}
          {filtered.length > visible.length && (
            <div className={sprinkles({ p: 3 })}>
              <button
                type="button"
                className={`${button({ variant: "outline" })} ${textSize.xs}`}
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Load more
              </button>
            </div>
          )}
        </div>
        {canWrite && (
          <div className={sprinkles({ p: 3 })} style={{ borderTop: borderStyle }}>
            <Stack gap={2}>
              <Input
                type="textarea"
                label="New entry"
                hideLabel
                name="statement"
                placeholder="New entry…"
                value={newStatement}
                onChange={(e) => setNewStatement(e.target.value)}
              />
              <button
                type="button"
                className={button({ variant: "secondary", size: "compact" })}
                disabled={adding || !newStatement.trim()}
                onClick={addEntry}
              >
                {adding ? "Adding…" : "Add entry"}
              </button>
            </Stack>
          </div>
        )}
      </Stack>

      <div className={sprinkles({ p: 5 })} style={{ flex: 1, overflowY: "auto" }}>
        {!selectedId ? (
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            Pick an entry to read it.
          </p>
        ) : loadingDetail && !detail ? (
          <p className={textSize.sm} style={{ color: semanticColors.textSubtle }}>
            Loading…
          </p>
        ) : detail ? (
          <Stack gap={3}>
            <Cluster gap={3} align="baseline" style={{ justifyContent: "space-between" }}>
              <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                {detail.entryDate ?? "?"}
                {detail.editedDate && detail.editedDate.slice(0, 10) !== detail.entryDate
                  ? ` · edited ${detail.editedDate.slice(0, 10)}`
                  : ""}
              </span>
              <button type="button" className={`${button({ variant: "quiet" })} ${textSize.xs}`} onClick={selectNext}>
                Next entry →
              </button>
            </Cluster>
            <p className={`${textSize.base} ${sprinkles({ fontWeight: "bold", m: 0 })}`}>{detail.statement}</p>
            {detail.body.trim() && (
              <p className={textSize.sm} style={{ whiteSpace: "pre-wrap" }}>
                {detail.body}
              </p>
            )}
            {detail.assets.length > 0 && (
              <Stack gap={1}>
                <span className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
                  Attachments
                </span>
                {detail.assets.map((a) => (
                  <span key={a.name} className={textSize.sm}>
                    {a.name}
                  </span>
                ))}
              </Stack>
            )}
          </Stack>
        ) : null}
      </div>
    </Surface>
  );
}
