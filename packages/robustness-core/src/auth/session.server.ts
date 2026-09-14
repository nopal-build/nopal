import { createCookieSessionStorage } from "react-router";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "_auth",
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 90, // 90 days
    secrets: [process.env.SESSION_SECRET || "NOT_A_STRONG_SECRET"],
    secure: process.env.NODE_ENV === "production",
    // Unset (undefined) -- exact-host-only. Resolved (see
    // docs/marketing-app-split-plan.md's open questions): login/sessions
    // live ENTIRELY on the app service (o.nopal.build) -- the marketing
    // site never touches this cookie at all, so there's no cross-domain
    // sharing to configure. Kept env-driven anyway since it's a free,
    // inert knob, not because it's expected to ever be set.
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
