// The send on a letter's page (Austin, 2026-10-27): a draft is sent,
// and sent again when it has changed. Three states, read from the
// record (`sentCopyOf`-shaped fields): never sent, sent and unchanged,
// sent and edited since. The server decides who may send
// (`letterSend.server.ts`); the page shows this to guides only. The
// public link is a second switch, on the project's Letters tab.
import { useState } from "react";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { localDateString } from "./TodayLog";
import { dayLabel } from "./dayLabel";

export const SEND_ASK = "Send this letter to the project? The client reads it on their project page as it is now. Nothing you change after reaches them until you send again.";
export const SEND_AGAIN_ASK = "Send the update? The client sees the letter as it is now, marked as updated.";

/** `sentDate` is the sender's day (YYYY-MM-DD), null before the first send. */
export type LetterSendState = { sentDate: string | null; sentCount: number; editedSinceSent: boolean };

export function LetterSendControl({ fileId, state, onSent }: { fileId: string; state: LetterSendState; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (again: boolean) => {
    if (!window.confirm(again ? SEND_AGAIN_ASK : SEND_ASK)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/letter/${fileId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: localDateString() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The letter didn't get sent.");
        return;
      }
      onSent();
    } finally {
      setBusy(false);
    }
  };

  const note = { color: semanticColors.textSubtle } as const;
  return (
    <span className={textSize.xs} style={{ display: "inline-flex", alignItems: "center", gap: 8 }} data-letter-send data-sent={state.sentDate ? (state.editedSinceSent ? "edited" : "sent") : "never"}>
      {state.sentDate && (
        <span style={note}>
          {state.editedSinceSent ? "Edited since you sent it" : `Sent ${dayLabel(state.sentDate)}${state.sentCount > 1 ? ", updated" : ""}`}
        </span>
      )}
      {(!state.sentDate || state.editedSinceSent) && (
        <button type="button" className="vault-toolbar-btn" disabled={busy} onClick={() => void send(!!state.sentDate)} data-send-button>
          {state.sentDate ? "Send again" : "Send"}
        </button>
      )}
      {error && (
        <span style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
