// How long a letter is, for the guide writing it (Austin, 2026-10-29):
// a word count and a read time under the Markdown pane. Counts the words
// a client reads, not the Markdown around them: galleries (pictures, the
// recording) and image embeds are skipped, a link counts its text and
// not its URL, and directive fences, list numbers and Markdown marks are
// not words.

/** Words a minute an adult reads prose at. */
export const READING_WORDS_PER_MINUTE = 230;

const GALLERY = /^[ \t]*:::gallery[^\n]*\n[\s\S]*?^[ \t]*:::[ \t]*$/gm;
const DIRECTIVE_LINE = /^[ \t]*::+[^\n]*$/gm;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const LIST_MARKER = /^[ \t]*(?:\d+[.)]|[-*+])[ \t]+/gm;
const WORD = /[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu;

/** The words a client reads in this letter body (front matter already off). */
export function letterWordCount(body: string): number {
  const prose = body
    .replace(HTML_COMMENT, " ")
    .replace(GALLERY, " ")
    .replace(DIRECTIVE_LINE, " ")
    .replace(LIST_MARKER, "")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(/https?:\/\/\S+/g, " ");
  return prose.match(WORD)?.length ?? 0;
}

/** "412 words · 2 min read": minutes round up, and an empty letter reads
 * "0 words" with no time. */
export function letterLengthLabel(body: string): string {
  const words = letterWordCount(body);
  const wordLabel = `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`;
  if (words === 0) return wordLabel;
  const minutes = Math.max(1, Math.ceil(words / READING_WORDS_PER_MINUTE));
  return `${wordLabel} · ${minutes} min read`;
}
