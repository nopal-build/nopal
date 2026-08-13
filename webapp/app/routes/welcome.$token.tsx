// app/routes/welcome.$token.tsx
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useSubmit,
  Form,
  Link,
} from "react-router";
import { startRegistration } from "@simplewebauthn/browser";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { getUser, updateUserSession } from "../modules/auth/auth.server";
import { sessionStorage } from "../modules/auth/session.server";
import {
  getHumanByInviteToken,
  isInviteTokenValid,
  addAliasEmail,
  consumeInviteToken,
  deleteHuman,
  type Human,
} from "robustness-core/data/humans.server";
import { repointRelationshipsToHuman } from "robustness-core/data/relationships.server";

async function loadInvitedHuman(
  token: string | undefined,
  existingUser: Human | null,
): Promise<Human> {
  const human = token ? await getHumanByInviteToken(token) : undefined;
  if (!human || !isInviteTokenValid(human)) {
    // Expired, already used, or bogus. If they're already signed in, send
    // them to their profile (where they can add a passkey directly) with a
    // clear reason instead of silently bouncing them further away — a bare
    // `redirect("/login")` here would immediately re-redirect to /fruits
    // for a signed-in user, with zero indication of what happened.
    throw redirect(
      existingUser ? "/fruits/profile?inviteExpired=1" : "/login",
    );
  }
  return human;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const existingUser = await getUser(request);
  const invitedHuman = await loadInvitedHuman(params.token, existingUser);

  if (existingUser && existingUser._id === invitedHuman._id) {
    // Literally the same account, already logged in — nothing to decide.
    return redirect("/fruits/profile");
  }

  return data({
    invitedName: invitedHuman.name,
    invitedEmail: invitedHuman.email,
    token: params.token as string,
    existingUser: existingUser
      ? { name: existingUser.name, email: existingUser.email }
      : null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const existingUser = await getUser(request);
  const invitedHuman = await loadInvitedHuman(params.token, existingUser);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "logout") {
    const session = await sessionStorage.getSession(
      request.headers.get("cookie"),
    );
    const setCookie = await sessionStorage.destroySession(session);
    return redirect(`/welcome/${params.token}`, {
      headers: { "Set-Cookie": setCookie },
    });
  }

  if (intent === "alias") {
    if (!existingUser) return redirect(`/welcome/${params.token}`);
    if (existingUser._id === invitedHuman._id) {
      return redirect("/fruits/profile");
    }

    // Fold the invited placeholder into the existing account: the invited
    // email becomes an alias, any relationships that were created against
    // the placeholder now point at the real account, and the placeholder
    // itself (never logged into) is removed.
    await addAliasEmail(existingUser._id, invitedHuman.email);
    await repointRelationshipsToHuman(invitedHuman._id, existingUser._id);
    await consumeInviteToken(invitedHuman._id);
    await deleteHuman(invitedHuman._id);

    const setCookie = await updateUserSession(request, {
      ...existingUser,
      aliasEmails: [
        ...(existingUser.aliasEmails ?? []),
        invitedHuman.email.trim().toLowerCase(),
      ],
    });

    return data(
      { intent: "alias" as const, success: true, email: invitedHuman.email },
      { headers: { "Set-Cookie": setCookie } },
    );
  }

  return redirect("/fruits");
}

function ExistingSessionChoice({
  invitedEmail,
  existingUser,
}: {
  invitedEmail: string;
  existingUser: { name: string; email: string };
}) {
  const actionData = useActionData<typeof action>();
  const aliasSuccess =
    actionData && "success" in actionData ? actionData : undefined;

  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-96 mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-4">
            You're already signed in
          </h1>
          <div className="flex flex-col gap-4 good-box p-4">
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              You're signed in as <strong>{existingUser.email}</strong>, but
              this passkey setup link was sent to{" "}
              <strong>{invitedEmail}</strong>. What would you like to do?
            </p>

            {aliasSuccess ? (
              <div className="text-sm" style={{ color: "var(--green)" }}>
                Done — {aliasSuccess.email} now signs in to this same
                account.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Link
                  to="/fruits"
                  className="btn-secondary justify-center text-center"
                >
                  Stay signed in as {existingUser.email}
                </Link>

                <Form method="post">
                  <input type="hidden" name="intent" value="alias" />
                  <button
                    className="btn-secondary w-full justify-center"
                    type="submit"
                  >
                    That's me — add {invitedEmail} as an alias
                  </button>
                </Form>

                <Form method="post">
                  <input type="hidden" name="intent" value="logout" />
                  <button
                    className="btn-secondary w-full justify-center"
                    type="submit"
                  >
                    Log out and set up {invitedEmail} instead
                  </button>
                </Form>
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer></Footer>
    </Layout>
  );
}

function PasskeySetup({
  invitedName,
  invitedEmail,
  token,
}: {
  invitedName: string;
  invitedEmail: string;
  token: string;
}) {
  const submit = useSubmit();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreatePasskey() {
    setError(null);
    setBusy(true);
    try {
      const optionsRes = await fetch("/api/passkeys/invite-register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(options.error ?? "Failed to start passkey setup.");
      }

      const registrationResponse = await startRegistration({
        optionsJSON: options,
      });

      const verifyRes = await fetch("/api/passkeys/invite-register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          response: registrationResponse,
          name: "Passkey",
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error ?? "Could not verify passkey.");
      }

      // Skip the login form entirely: submit the email straight to /login's
      // action, which sends the TOTP code and redirects to /verify — same as
      // if the user had typed their email and clicked "Send Code" manually.
      submit({ email: invitedEmail }, { method: "post", action: "/login" });
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled the browser's passkey prompt — not a real error.
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong setting up your passkey.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-96 mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-4">
            Welcome, {invitedName}
          </h1>
          <div className="flex flex-col gap-4 good-box p-4">
            <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
              Set up a passkey so you can sign in instantly with your
              fingerprint, face, or PIN — no email codes to wait for.
            </p>
            {error && <div className="red-text text-sm">{error}</div>}
            <div className="text-right">
              <button
                className="btn-secondary"
                type="button"
                disabled={busy}
                onClick={handleCreatePasskey}
              >
                {busy ? "Setting up…" : "Create a passkey"}
              </button>
            </div>
          </div>
          <div className="mt-8 text-center">
            <Link
              to={`/login?email=${encodeURIComponent(invitedEmail)}`}
              className="link"
            >
              Skip for now — I'll use an email code
            </Link>
          </div>
        </div>
      </div>
      <Footer></Footer>
    </Layout>
  );
}

export default function WelcomePasskeySetup() {
  const { invitedName, invitedEmail, token, existingUser } =
    useLoaderData<typeof loader>();

  if (existingUser) {
    return (
      <ExistingSessionChoice
        invitedEmail={invitedEmail}
        existingUser={existingUser}
      />
    );
  }

  return (
    <PasskeySetup
      invitedName={invitedName}
      invitedEmail={invitedEmail}
      token={token}
    />
  );
}
