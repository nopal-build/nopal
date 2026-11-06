// The desk with one letter on it: what the page at
// `routes/newspaper.$folderId_.letter.$fileId.tsx` draws (Austin,
// 2026-11-06: "it should feel like you are still in the project, at the
// desk and writing a letter"). The project's name, the way back to the
// desk, and the letter being written. Nothing else: no tabs, no mailbox,
// no file tree.
//
// What the letter does is `LetterWriting`, the component the Vault also
// mounts. Around it here: a save that says so on the page when it fails
// (the Vault's uses an alert), "See it as they will", and Delete on a
// letter that has never gone out (the route refuses the rest).
//
// Who decides what. A person: writing, sending, deleting a draft. Code:
// who the page opens for (the route's loader, `letterWritingFor`).
import { useCallback, useState } from "react";
import type { LetterBriefForPage } from "robustness-core/data/brief.server";
import { CenterContent } from "stamps/CenterContent";
import { Cluster } from "stamps/Cluster";
import { Stack } from "stamps/Stack";
import { link } from "stamps/link.css";
import { sprinkles } from "stamps/sprinkles.css";
import { semanticColors } from "stamps/tokens";
import { textSize } from "stamps/typography.css";
import { AppLayout } from "./AppLayout";
import type { LetterSendState } from "./LetterSendControl";
import { LetterWriting, type LetterBeingWritten } from "./LetterWriting";
import { LETTER_DELETE_DRAFT_ASK, letterPublicPath } from "./LettersView";

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const DESK_BACK = "The desk";
export const LETTER_SEE_AS_SENT = "See it as they will";
export const LETTER_DELETE = "Delete";
export const LETTER_SAVE_FAILED = "That didn't save. Keep this page open and try again in a moment.";

export function LetterDesk({
  project,
  letter,
  brief,
  send,
  writer,
  onSent,
  onDeleted,
}: {
  project: { _id: string; title: string };
  letter: LetterBeingWritten & { title: string; goneOut: boolean };
  brief: LetterBriefForPage | null;
  send: LetterSendState | null;
  /** Whose letter (`letterWritingFor`): a client's has no brief block. */
  writer: "guide" | "client";
  onSent: () => void;
  /** Given the desk's address to go back to. */
  onDeleted: (desk: string) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const desk = `/newspaper/${project._id}?tab=letters`;

  // The letter's own save (`api.letter.$fileId.tsx`), behind the same
  // rule as this page. Never throws: `LetterWriting` reads a truthy
  // answer as "it landed", and a failure is said on the page.
  const save = useCallback(async (fileId: string, content: string) => {
    try {
      const res = await fetch(`/api/letter/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setProblem(data?.error ?? LETTER_SAVE_FAILED);
        return null;
      }
      setProblem(null);
      return data ?? true;
    } catch {
      setProblem(LETTER_SAVE_FAILED);
      return null;
    }
  }, []);

  const remove = async () => {
    if (!window.confirm(LETTER_DELETE_DRAFT_ASK)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/letter/${letter._id}/remove`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setProblem(data?.error ?? "That didn't delete. Try again.");
        return;
      }
      onDeleted(desk);
    } catch {
      setProblem("That didn't delete. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppLayout>
      <CenterContent maxWidth={1280}>
        <Stack gap={4} data-letter-desk={letter._id}>
          <Cluster gap={3} align="baseline">
            <a href={`/newspaper/${project._id}`} className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`} style={{ color: "inherit" }} data-desk-project>
              {project.title}
            </a>
            <a href={desk} className={`${link} ${textSize.sm}`} data-desk-back>
              ← {DESK_BACK}
            </a>
          </Cluster>
          {problem && (
            <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textDanger }} role="alert" data-desk-problem>
              {problem}
            </p>
          )}
          <div>
            <LetterWriting
              file={letter}
              projectFolderId={project._id}
              brief={brief}
              send={send}
              writer={writer}
              editable
              headerLeft={
                <span className={`${textSize.lg} ${sprinkles({ fontWeight: "semibold" })}`} data-desk-title>
                  {letter.title}
                </span>
              }
              toolbarExtra={
                <>
                  <a href={letterPublicPath(letter._id)} className="vault-toolbar-btn" data-desk-see>
                    {LETTER_SEE_AS_SENT}
                  </a>
                  {!letter.goneOut && (
                    <button type="button" className="vault-toolbar-btn" disabled={busy} onClick={() => void remove()} data-desk-delete>
                      {LETTER_DELETE}
                    </button>
                  )}
                </>
              }
              save={save}
              onSent={onSent}
            />
          </div>
        </Stack>
      </CenterContent>
    </AppLayout>
  );
}
