/**
 * The Letters tile in the project's banner (Austin, 2026-10-22).
 *
 * A client has no Letters tab: that tab is where guides work. What
 * a guide has sent shows here instead, beside the Steep-o-meter, the
 * way the seed packet shows while a round is open: only when there is
 * something, never another tab to keep checking. Each line opens the
 * letter's page, where someone on the project reads the sent copy
 * logged in (and anyone with the link, once the link is on).
 *
 * Who decides what. A person: what is sent (the control on the
 * letter's page). Code: that only sent letters are listed
 * (`sentLetterLinks`), and the date and "updated" beside each.
 */
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { dayLabel } from "./dayLabel";

export type LetterLink = { fileId: string; title: string; path: string; sentDate: string; updated: boolean };

export function LettersTile({ links }: { links: LetterLink[] }) {
  if (links.length === 0) return null;
  return (
    <Surface data-letters-tile className={sprinkles({ padding: 5 })} style={{ width: "100%", maxWidth: 440, marginLeft: "auto" }}>
      <Stack gap={3}>
        <span className={`${textSize.sm} ${sprinkles({ fontWeight: "semibold" })}`}>Your letters</span>
        <ul className={textSize.sm} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {links.map((l) => (
            <li key={l.fileId}>
              <a href={l.path} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>
                {l.title}
              </a>
              <span className={textSize.xs} style={{ color: semanticColors.textSubtle }} data-letter-sent>
                {" · "}sent {dayLabel(l.sentDate)}
                {l.updated && ", updated"}
              </span>
            </li>
          ))}
        </ul>
      </Stack>
    </Surface>
  );
}
