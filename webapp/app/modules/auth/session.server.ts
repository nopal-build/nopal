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
    // Unset (undefined) today -- exact-host-only, same as before this was
    // added. Exists so a FUTURE split across subdomains (e.g. nopal.build /
    // o.nopal.build sharing one login session) can opt in to a shared
    // cookie with e.g. SESSION_COOKIE_DOMAIN=.nopal.build, without another
    // code change -- see docs/marketing-app-split-plan.md's "Critical
    // risks" #2. Leave unset unless/until that's actually needed.
    domain: process.env.SESSION_COOKIE_DOMAIN || undefined,
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
