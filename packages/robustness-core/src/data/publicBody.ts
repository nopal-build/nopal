/**
 * What a public page does to a body's file URLs.
 *
 * Markdown in the vault points its pictures at `/api/vault/view/<id>`,
 * which needs a session. A public page (the shared Efforts page,
 * `newspaperShare.server.ts`; a letter, `letters.server.ts`)
 * rewrites every one of those to its own file route, and serves under
 * that route exactly the ids the body names right now, nothing else.
 * Both pages use these two functions so there is one definition of
 * "a file URL in a body".
 */

const VIEW_URL = /\/api\/vault\/view\/([A-Za-z0-9]+)/g;

/** Every `/api/vault/view/<id>` in `text`, pointed at `toUrl(id)`. */
export function rewriteViewUrls(text: string, toUrl: (id: string) => string): string {
  return text.replace(VIEW_URL, (_, id: string) => toUrl(id));
}

/** The file ids `text` names by view URL. */
export function viewFileIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(VIEW_URL)) ids.add(m[1]);
  return ids;
}
