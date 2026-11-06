// The send on a letter's page (Austin, 2026-10-27): a draft is sent,
// and sent again when it has changed. Three states, read from the
// record (`sentCopyOf`-shaped fields): never sent, sent and unchanged,
// sent and edited since. The server decides who may send
// (`letterSend.server.ts`); the page shows this to the letter's writer. The
// public link is a second switch, on the project's Letters tab.
//
// And where it goes (Austin, 2026-11-05: a letter is delivered to a
// house). That is picked when the letter is started, on the New letter
// form, so here there is one button with where it is going after it
// ("Send to the clients", read as a sentence), and a question that
// names it (`letterSendStateFor`, `houseAtSend`).
// Only a draft with no address (an upload, or one started before the
// form asked) is asked here: two buttons, the clients or the team, no
// default and no list of people.
import { useState } from "react";
import { HOUSE_LABEL, type House } from "robustness-core/data/letterHouses";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { localDateString } from "./TodayLog";
import { dayLabel } from "./dayLabel";

// The question's two halves, so naming the house in the middle can't
// drift from the words: `sendAsk` puts them together.
export const SEND_ASK_VERB = "Send this letter";
export const SEND_ASK_TAIL = "It goes in their mailbox on the project page as it is now. Nothing you change after reaches them until you send again.";
export const SEND_AGAIN_ASK_VERB = "Send the update";
export const SEND_AGAIN_ASK_TAIL = "They see the letter as it is now, marked as updated, and their flag goes up again.";
export const SEND_ASK = `${SEND_ASK_VERB}? ${SEND_ASK_TAIL}`;
export const SEND_AGAIN_ASK = `${SEND_AGAIN_ASK_VERB}? ${SEND_AGAIN_ASK_TAIL}`;

/** The question before a send, naming the house when it is known. */
export function sendAsk(again: boolean, house: House | null | undefined): string {
  const [verb, tail] = again ? [SEND_AGAIN_ASK_VERB, SEND_AGAIN_ASK_TAIL] : [SEND_ASK_VERB, SEND_ASK_TAIL];
  return `${verb}${house ? ` to ${HOUSE_LABEL[house]}` : ""}? ${tail}`;
}

/** `sentDate` is the sender's day (YYYY-MM-DD), null before the first
 * send. `toHouse` is where the letter goes when that is already decided;
 * `asksHouse` when the guide has to say (both absent on a page that
 * hasn't been told, which sends as before and lets the server refuse). */
export type LetterSendState = { sentDate: string | null; sentCount: number; editedSinceSent: boolean; toHouse?: House | null; asksHouse?: boolean };

/** The page reads "edited since" once per load, and a letter's autosave
 * doesn't reload the page (`vault.tsx`), so a save that lands after the
 * load moves the state on here: a sent letter saved over since this load
 * offers "Send again" without a reload. `savedOver` is the load (file id
 * and `updated_at`) the last save landed on; a fresh load has a new key,
 * and its own read wins. */
export function sendStateAfterSaves(state: LetterSendState, loadedKey: string | null, savedOver: string | null): LetterSendState {
  if (!state.sentDate || !loadedKey || savedOver !== loadedKey) return state;
  return { ...state, editedSinceSent: true };
}

export function LetterSendControl({ fileId, state, onSent }: { fileId: string; state: LetterSendState; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (again: boolean, to: House | null) => {
    if (!window.confirm(sendAsk(again, to))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/letter/${fileId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: localDateString(), ...(to ? { to } : {}) }),
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
  const sendWord = state.sentDate ? "Send again" : "Send";
  return (
    <span className={textSize.xs} style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }} data-letter-send data-sent={state.sentDate ? (state.editedSinceSent ? "edited" : "sent") : "never"}>
      {state.sentDate && (
        <span style={note}>
          {state.editedSinceSent ? "Edited since you sent it" : `Sent ${dayLabel(state.sentDate)}${state.sentCount > 1 ? ", updated" : ""}`}
          {state.toHouse && !state.editedSinceSent && <span data-sent-to>{` to ${HOUSE_LABEL[state.toHouse]}`}</span>}
        </span>
      )}
      {(!state.sentDate || state.editedSinceSent) &&
        (state.asksHouse ? (
          // The choice of house is the button: nothing is picked for them.
          (["clients", "guides"] as const).map((house) => (
            <button key={house} type="button" className="vault-toolbar-btn" style={{ whiteSpace: "nowrap" }} disabled={busy} onClick={() => void send(!!state.sentDate, house)} data-send-button data-send-to={house}>
              {`${sendWord} to ${HOUSE_LABEL[house]}`}
            </button>
          ))
        ) : (
          // The button, then where it is going, so the two read as one
          // sentence: "Send to the clients" (Austin, 2026-11-05). Kept
          // together on one line.
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <button type="button" className="vault-toolbar-btn" disabled={busy} onClick={() => void send(!!state.sentDate, state.toHouse ?? null)} data-send-button>
              {sendWord}
            </button>
            {state.toHouse && (
              <span style={note} data-send-to-note>
                to {HOUSE_LABEL[state.toHouse]}
              </span>
            )}
          </span>
        ))}
      {error && (
        <span style={{ color: semanticColors.textDanger }} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
