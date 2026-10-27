/**
 * The Letters tile in the project's banner (Austin, 2026-10-22).
 *
 * A client has no Letters tab: that tab is where guides work. What
 * a guide has shared shows here instead, beside the Steep-o-meter, the
 * way the seed packet shows while a round is open: only when there is
 * something, never another tab to keep checking. Each line opens the
 * public page, the same link the client sends a contractor.
 *
 * Who decides what. A person: what is shared (the switch on the tab).
 * Code: that only shared letters are listed (`sharedLetterLinks`).
 */
import { Stack } from "stamps/Stack";
import { Surface } from "stamps/Surface";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";

export type LetterLink = { fileId: string; title: string; path: string };

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
            </li>
          ))}
        </ul>
      </Stack>
    </Surface>
  );
}
