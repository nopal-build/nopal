/**
 * How the app names a person (Austin, 2026-09-29): by first name in
 * prose (the people line, a card's author, a Steep note, "Hello,"), by
 * full name in a list where they're being picked out, and never by
 * their login email. Someone who hasn't set a name goes by the part of
 * their email before the @, which is usually a name anyway.
 *
 * Plain module (no `.server`): the screen names people too.
 */

type Named = { name?: string | null; email: string };

/** The name a list shows: their name, or the bit before the @. A name
 * that is itself an email address (the seed, an invite with no name
 * typed) counts as no name. */
export function displayName(h: Named): string {
  const name = (h.name ?? "").trim();
  return name && !name.includes("@") ? name : h.email.split("@")[0];
}

/** The name prose uses: their first name, or the bit before the @. */
export function firstName(h: Named): string {
  return displayName(h).split(/\s+/)[0];
}
