import { Authenticator } from "remix-auth";
import { TOTPStrategy } from "remix-auth-totp";
import { redirect } from "react-router";
import { sessionStorage } from "./session.server";
import { sendEmail } from "../../util/email.server";
import { Human, getHumanByEmail } from "../../data/humans.server";
import { LoginCode } from "../../emails/loginCode";

export const authenticator = new Authenticator<Human>();

authenticator.use(
  new TOTPStrategy(
    {
      secret: process.env.ENCRYPTION_SECRET || "NOT_A_STRONG_SECRET",
      magicLinkPath: "/magic-link",
      emailSentRedirect: "/verify",
      successRedirect: "/fruits",
      failureRedirect: "/verify",
      sendTOTP: async ({ email, code, magicLink }) => {
        await sendEmail({
          to: [email],
          subject: "Nopal Login Code",
          react: LoginCode({ code, magicLink }),
        });
      },
    },
    async ({ email, request }) => {
      const human = await getHumanByEmail(email);
      if (!human) throw new Error("No account found for that email address.");
      // Set user in session; strategy will catch this Response, add _totp clearing cookie, and re-throw
      const session = await sessionStorage.getSession(
        request.headers.get("cookie"),
      );
      session.set("user", human);
      throw redirect("/fruits", {
        headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
      });
    },
  ),
  "TOTP",
);

/** Get authenticated user from session, or null if not logged in */
export async function getUser(request: Request): Promise<Human | null> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  return session.get("user") ?? null;
}

/**
 * Update the session's stored user (e.g. after editing a profile) so later
 * requests reflect the change. Returns the `Set-Cookie` header to attach to
 * the response.
 */
export async function updateUserSession(
  request: Request,
  user: Human,
): Promise<string> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  session.set("user", user);
  return sessionStorage.commitSession(session);
}

/** Read error message from the _totp cookie (set by TOTPStrategy on failures) */
export function getAuthError(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const totpCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_totp="));
  if (!totpCookie) return null;
  try {
    const value = decodeURIComponent(totpCookie.slice("_totp=".length));
    return new URLSearchParams(value).get("error");
  } catch {
    return null;
  }
}

/** Read email from the _totp cookie (set by TOTPStrategy during the email→verify flow) */
export function getAuthEmail(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const totpCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("_totp="));
  if (!totpCookie) return null;
  try {
    const value = decodeURIComponent(totpCookie.slice("_totp=".length));
    return new URLSearchParams(value).get("email");
  } catch {
    return null;
  }
}
