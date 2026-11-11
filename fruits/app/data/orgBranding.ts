// app/data/orgBranding.ts
//
// The generic TERM this app uses for "Organization" in the UI — distinct
// from any one Organization's own NAME (e.g. "Nopal",
// `organizations.server.ts`'s `Organization.name`, already fully
// dynamic/DB-driven and shown everywhere as `{organizationName}
// {ORG_TERM}`). If this product is ever white-labeled under a different
// word for the concept ("Team", "Company", "Agency", ...), change it
// here once — every UI surface that shows the term reads from this one
// place instead of a hard-coded string of its own.
//
// Plain module, deliberately NOT `.server` — `AppLayout.tsx`'s nav is a
// client-rendered component, not a route loader, and importing a runtime
// value from a `.server.ts` module into client-reachable code breaks
// React Router's server/client code-splitting (hit this exact bug with
// `profile.tsx`'s own Availability section — see that fix's own
// commentary). This file has no server dependencies at all, so both
// route loaders/actions and `AppLayout` can import it safely.

/** The full word, used wherever there's room for it ("{name}
 * Organization", "Organization members", a field label, ...). */
export const ORG_TERM = "Airy.Ya";

/** The short form, for tight spaces — today's "Org" nav tab, and the
 * fallback name shown before any real Organization has loaded. */
export const ORG_TERM_SHORT = "Airy";
