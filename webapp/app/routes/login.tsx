import { useState } from "react";
import { Input } from "stamps/Input";
import { surfaceBase } from "stamps/surface.css";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { useLoaderData, useActionData, useNavigate, Form } from "react-router";
import {
  data,
  redirect,
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  authenticateWithRedirect,
  getUser,
  getAuthError,
  isSafeRedirectPath,
} from "../modules/auth/auth.server";
import { getHumanByEmail } from "robustness-core/data/humans.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const redirectToParam = url.searchParams.get("redirectTo");
  const redirectTo = isSafeRedirectPath(redirectToParam) ? redirectToParam : null;

  const user = await getUser(request);
  if (user) return redirect(redirectTo ?? "/fruits");

  const authError = getAuthError(request);
  const prefillEmail = url.searchParams.get("email") ?? "";
  return data({ authError, prefillEmail, redirectTo });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.clone().formData();
  const email = formData.get("email") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  const user = await getHumanByEmail(email);
  if (!user) {
    return data(
      { error: "No account found for that email address." },
      { status: 400 },
    );
  }
  if (user.suspendedAt) return redirect("/login-error");

  // Strategy sends TOTP and throws redirect to /verify (redirectTo, if any,
  // rides along in a short-lived cookie so /verify's success lands there).
  await authenticateWithRedirect(request, redirectTo);
}

export default function Login() {
  let { authError, prefillEmail, redirectTo } = useLoaderData<typeof loader>();
  let actionData = useActionData<typeof action>();
  const navigate = useNavigate();

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  async function handlePasskeyLogin() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    try {
      const optionsRes = await fetch("/api/passkeys/login-options", {
        method: "POST",
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(options.error ?? "Failed to start passkey login.");
      }

      const authResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch("/api/passkeys/login-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: authResponse }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.suspended) {
        navigate("/login-error");
        return;
      }
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error ?? "Could not verify passkey.");
      }

      navigate(redirectTo ?? "/fruits");
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled the browser's passkey prompt — not a real error.
        return;
      }
      setPasskeyError(
        err instanceof Error
          ? err.message
          : "Something went wrong signing in with your passkey.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <Layout>
      <div className="scene1">
        <div className="w-full max-w-96 mx-auto px-4 py-12">
          <h1 className="text-3xl purple-light-text font-bold mb-4">Login</h1>
          <Form method="POST" className={`flex flex-col gap-4 ${surfaceBase} p-4`}>
            {redirectTo && (
              <input type="hidden" name="redirectTo" value={redirectTo} />
            )}
            <Input
              label="Email"
              name="email"
              defaultValue={prefillEmail}
              required
              placeholder="you@nature.yeah"
            />
            {actionData?.error && <div className="red-text">{authError}</div>}
            <div className="text-right">
              <button className="btn-secondary" type="submit">
                Send Code
              </button>
            </div>
          </Form>

          <div
            className="text-center my-4"
            style={{ color: "var(--text-subtle)" }}
          >
            or
          </div>

          <div className={`flex flex-col gap-2 ${surfaceBase} p-4`}>
            {passkeyError && (
              <div className="red-text text-sm">{passkeyError}</div>
            )}
            <button
              className="btn-secondary"
              type="button"
              disabled={passkeyBusy}
              onClick={handlePasskeyLogin}
            >
              {passkeyBusy ? "Signing in…" : "Sign in with a passkey"}
            </button>
          </div>
        </div>
      </div>
      <Footer></Footer>
    </Layout>
  );
}
