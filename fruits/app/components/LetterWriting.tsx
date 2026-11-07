// A letter being written: its workings (the brief when it has one, the
// talk box, the outline), the editor, and Send. One component, mounted in
// two places: the project's desk (`routes/newspaper.$folderId_.letter.$fileId.tsx`),
// which is where the letters workflow leads, and the Vault, where a
// letter still opens for a guide who goes looking in the file tree
// (Austin, 2026-11-06: "The whole letters workflow shouldn't go to the
// vault, it should feel like you are still in the project, at the desk
// and writing a letter").
//
// What differs between the two is handed in: what sits at the header's
// left (a title here, the Vault's breadcrumb there), anything extra in
// the toolbar, how a save is made, and what happens after a send. The
// Vault's Actions menu is the Vault's and stays there.
//
// The editor is keyed by the letter and when it was last saved, as it
// always was: a different letter, or the same one changed by another
// path, starts a fresh editor. Without the key the editor would keep the
// last letter's words and its autosave would write them into this one.
//
// "Edited since sent" is read once per load and a letter's autosave does
// not reload the page, so a save that lands moves the send control on
// here (`sendStateAfterSaves`); a send clears it.
import { useCallback, useState, type ReactNode } from "react";
import type { LetterBriefForPage } from "robustness-core/data/brief.server";
import { CopyLinkButton } from "./CopyLinkButton";
import { LetterBrief, isLetterOnlyItsHeading } from "./LetterBrief";
import { LetterSendControl, sendStateAfterSaves, type LetterSendState } from "./LetterSendControl";
import { LetterSplitEditor } from "./LetterSplitEditor";
import { letterPublicPath } from "./letterPaths";

/** What of a letter's record the writing page reads. */
export type LetterBeingWritten = {
  _id: string;
  folder_id?: string | null;
  updated_at?: string | null;
  content?: string | null;
  purpose?: string | null;
  shared_at?: string | null;
};

/** The editor's key: the letter and its last save. */
export function letterEditorKey(file: Pick<LetterBeingWritten, "_id" | "updated_at">): string {
  return `${file._id}-${file.updated_at}`;
}

export function LetterWriting({
  file,
  projectFolderId,
  brief,
  send,
  editable,
  writer,
  headerLeft,
  toolbarExtra,
  save,
  onSent,
}: {
  file: LetterBeingWritten;
  /** Whose letter: a client's page has no brief block. The Vault, which
   * a client never reaches, says "guide". */
  writer: "guide" | "client";
  /** Where "Add picture" looks first. */
  projectFolderId: string | null;
  /** The letter's workings, for whoever may write the letter; null hides them. */
  brief: LetterBriefForPage | null;
  /** The send's state, for whoever may write the letter; null hides Send and
   * "Read it to them". */
  send: LetterSendState | null;
  editable: boolean;
  headerLeft?: ReactNode;
  /** After Send and the link button. */
  toolbarExtra?: ReactNode;
  /** Saves the letter's content. Resolves to something truthy when the
   * save landed, and never throws. */
  save: (fileId: string, content: string) => Promise<unknown>;
  onSent: () => void;
}) {
  const loadedKey = letterEditorKey(file);
  const [savedOver, setSavedOver] = useState<string | null>(null);
  const onSave = useCallback(
    async (fileId: string, content: string) => {
      const saved = await save(fileId, content);
      if (saved) setSavedOver(loadedKey);
      return saved;
    },
    [save, loadedKey],
  );

  return (
    <>
      {brief && <LetterBrief key={`brief-${file._id}`} fileId={file._id} initial={brief} hasPurpose={!!file.purpose?.trim()} withBrief={writer !== "client"} openByDefault={isLetterOnlyItsHeading(file.content ?? "")} />}
      <LetterSplitEditor
        key={loadedKey}
        fileId={file._id}
        folderId={file.folder_id ?? null}
        projectFolderId={projectFolderId}
        initialContent={file.content ?? ""}
        editable={editable}
        onSave={onSave}
        headerLeft={headerLeft}
        toolbarRight={
          <>
            {send && (
              <LetterSendControl
                fileId={file._id}
                state={sendStateAfterSaves(send, loadedKey, savedOver)}
                onSent={() => {
                  setSavedOver(null);
                  onSent();
                }}
              />
            )}
            {file.shared_at && <CopyLinkButton path={letterPublicPath(file._id)} />}
            {toolbarExtra}
          </>
        }
        purpose={file.purpose ?? null}
        recordable={!!send}
      />
    </>
  );
}
