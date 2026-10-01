// "Print an update" on the Efforts page (ADR-030). The page is rebuilt
// only when someone asks: anyone on the project once the last print is a
// week old, a guide or staff any time. A print runs the graph first, then
// the page, so marks made just before it are on what it prints. The
// allowance comes from the loader (`printAllowance`); the POST is checked
// again on the server (`api.graphlog.print.tsx`).
import { useEffect, useState } from "react";
import { Cluster } from "stamps/Cluster";
import { button } from "stamps/button.css";
import { textSize } from "stamps/typography.css";

export type PrintForPage = {
  printedAt: string | null;
  allowance: { may: boolean; anytime: boolean; nextAt: string | null };
};

/** "Sep 24". Rendered in UTC on the server and the first paint, then in
 * the reader's own zone once the page is live, so an evening print
 * doesn't read as tomorrow. */
function useShortDate(iso: string | null): string | null {
  const format = (timeZone?: string) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone }) : null;
  const [label, setLabel] = useState(() => format("UTC"));
  useEffect(() => setLabel(format()), [iso]);
  return label;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export function PrintUpdate({
  projectFolderId,
  print,
  onPrinted,
}: {
  projectFolderId: string;
  print: PrintForPage;
  onPrinted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const printed = useShortDate(print.printedAt);
  const next = useShortDate(print.allowance.nextAt);

  const follow = async (jobId: string): Promise<string> => {
    const url = `/api/graphlog/print?projectFolderId=${encodeURIComponent(projectFolderId)}&jobId=${encodeURIComponent(jobId)}`;
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch(url);
      if (!res.ok) throw new Error(await readError(res, "Couldn't follow the print."));
      const data = (await res.json()) as { job: { state: string; readmeChanged: boolean | null; error: string | null } | null };
      if (data.job?.state === "failed") throw new Error(data.job.error ?? "The print stopped on an error.");
      if (data.job?.state === "completed") {
        return data.job.readmeChanged ? "Printed." : "Nothing new since the last print.";
      }
    }
  };

  const press = async () => {
    setBusy(true);
    setMessage("Printing. This takes a few minutes.");
    try {
      const res = await fetch("/api/graphlog/print", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectFolderId }),
      });
      if (res.status === 409) {
        setMessage("GraphLog is already working on this project. Try again in a few minutes.");
        return;
      }
      if (!res.ok) {
        setMessage(await readError(res, "That didn't go through. Try again."));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      setMessage(await follow(jobId));
      onPrinted();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const canSee = print.allowance.may || print.allowance.nextAt !== null;
  return (
    <Cluster gap={3} align="center" data-print-update style={{ marginBottom: 12 }}>
      <span className={textSize.sm}>{printed ? `Printed ${printed}` : "Not printed yet"}</span>
      {canSee && (
        <button
          type="button"
          className={button({ variant: "secondary", size: "compact" })}
          disabled={busy || !print.allowance.may}
          onClick={() => void press()}
        >
          {busy ? "Printing…" : "Print an update"}
        </button>
      )}
      {!print.allowance.may && next && !message && (
        <span className={textSize.xs}>Next print opens {next}.</span>
      )}
      {message && <span className={textSize.xs}>{message}</span>}
    </Cluster>
  );
}
