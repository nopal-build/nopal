/**
 * The mailbox on the project's page (Austin, 2026-11-05: "think of it as
 * a physical mailbox, so instead of the letters showing up on a generic
 * tile on a person's project page, there is a mailbox that's always
 * there. And when you have mail, a little purple mail flag pops up and
 * you can read your mail").
 *
 * For everyone on the project, in the banner where the letters tile was.
 * It holds the letters sent to your house by someone other than you and
 * keeps them after you open them (`mailboxLines`). The flag is up while
 * one of them is unopened by you. Opening the mailbox lowers nothing;
 * opening a letter does, on the letter's own page. Never a number, never
 * hidden when empty. No email or notice goes with it: the flag is the
 * only signal.
 *
 * Each line opens that letter alone, in its own tab as the tile did. The
 * project's page is asked again when the reader comes back to it, so the
 * flag and the dots are true without a reload.
 *
 * Who decides what. A person: to look. Code: what is in the mailbox and
 * whether the flag is up.
 */
import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { Modal } from "stamps/Modal";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { Mailbox } from "./stamps-candidates/Mailbox";
import { dayLabel } from "./dayLabel";

/** A line as the page receives it: `from` is the writer's first name, or
 * null for a letter sent before letters had a house. */
export type Mail = { fileId: string; title: string; path: string; sentDate: string; updated: boolean; from: string | null; unopened: boolean };

// Words a person reads (Nopal's voice; listed in the round's return leg).
export const MAILBOX_LABEL = "Mail";
export const MAILBOX_EMPTY = "Nothing in the mailbox yet.";
export const MAILBOX_SAYS_NEW = "Mail. There is a letter you haven't opened.";
export const MAILBOX_SAYS_QUIET = "Mail. Nothing new.";

export function ProjectMailbox({ mail }: { mail: Mail[] }) {
  const [open, setOpen] = useState(false);
  const revalidator = useRevalidator();
  // A letter opens in its own tab; when the reader is back on this one,
  // ask the page again so their flag and the dots have caught up.
  const wentToALetter = useRef(false);
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible" || !wentToALetter.current) return;
      wentToALetter.current = false;
      revalidator.revalidate();
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [revalidator]);

  const flagUp = mail.some((m) => m.unopened);
  return (
    <>
      <Mailbox
        flagUp={flagUp}
        onOpen={() => setOpen(true)}
        label={<span className={textSize.xs}>{MAILBOX_LABEL}</span>}
        description={flagUp ? MAILBOX_SAYS_NEW : MAILBOX_SAYS_QUIET}
        data-project-mailbox
      />
      <Modal open={open} onClose={() => setOpen(false)} title={MAILBOX_LABEL} maxWidth={480}>
        <MailList mail={mail} onOpenLetter={() => (wentToALetter.current = true)} />
      </Modal>
    </>
  );
}

/** What is in the mailbox, newest first. A dot marks a letter the reader
 * hasn't opened; nothing here says how many there are. */
export function MailList({ mail, onOpenLetter }: { mail: Mail[]; onOpenLetter?: () => void }) {
  if (mail.length === 0) {
    return (
      <p className={textSize.sm} style={{ margin: 0, color: semanticColors.textSubtle }} data-mailbox-empty>
        {MAILBOX_EMPTY}
      </p>
    );
  }
  return (
    <ul className={textSize.sm} style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }} data-mailbox-list>
      {mail.map((m) => (
        <li key={m.fileId} style={{ display: "flex", alignItems: "flex-start", gap: 8 }} data-mail={m.fileId} data-unopened={m.unopened ? "" : undefined}>
          <span
            aria-hidden={!m.unopened}
            aria-label={m.unopened ? "Not opened yet" : undefined}
            style={{ flex: "none", width: 8, height: 8, marginTop: 7, borderRadius: "50%", background: m.unopened ? semanticColors.textBrand : "transparent" }}
          />
          {/* The title, then who and when under it: two short lines hold
              on a phone where one long one broke mid-phrase. */}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <a href={m.path} target="_blank" rel="noreferrer" onClick={onOpenLetter} style={{ overflowWrap: "anywhere" }}>
              {m.title}
            </a>
            <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-sent>
              {m.from ? `from ${m.from} · ` : ""}
              {dayLabel(m.sentDate)}
              {m.updated && ", updated"}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
