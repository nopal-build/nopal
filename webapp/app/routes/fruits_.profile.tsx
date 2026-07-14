// app/routes/fruits_.profile.tsx
import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  Form,
  Link,
} from "react-router";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { getUser, updateUserSession } from "../modules/auth/auth.server";
import {
  getHumanByEmail,
  updateHumanName,
  isEmailTakenByAnotherHuman,
  startEmailChange,
  isPendingEmailCodeValid,
  clearPendingEmailChange,
  recordFailedEmailCodeAttempt,
  applyPendingEmailChange,
  removeAliasEmail,
  type Human,
} from "../data/humans.server";
import { sendEmail } from "../util/email.server";
import { ConfirmEmail } from "../emails/confirmEmail";
import { EmailChangeNotice } from "../emails/emailChangeNotice";
import {
  createRelationship,
  getRelatedHumans,
} from "../data/relationships.server";
import { inviteHuman } from "../data/invites.server";
import {
  getLegalDocumentsByEmail,
  type LegalDocumentRecord,
} from "../data/legalDocuments.server";
import {
  getPasskeysByHuman,
  getPasskeyById,
  deletePasskey,
  type Passkey,
} from "../data/passkeys.server";
import { AppLayout } from "../components/AppLayout";
import { Input } from "../components/Input";
import { Modal } from "../components/Modal";
import {
  getKnownAccounts,
  rememberAccount,
  forgetAccount,
  type KnownAccount,
} from "../util/knownAccounts";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAdminOrSuper(user: Human): boolean {
  return user.role === "Admin" || user.role === "Super";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return redirect("/login");
  const [waivers, relatedHumans, passkeys] = await Promise.all([
    getLegalDocumentsByEmail(user.email),
    getRelatedHumans(user),
    getPasskeysByHuman(user._id),
  ]);
  const url = new URL(request.url);
  const inviteExpired = url.searchParams.get("inviteExpired") === "1";
  return { user, waivers, relatedHumans, passkeys, inviteExpired };
}

// ─── Action ───────────────────────────────────────────────────────────────────

async function handleUpdateName(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const name = String(form.get("name") ?? "").trim();
  if (!name) {
    return data(
      { intent: "update-name" as const, error: "Name is required." },
      { status: 400 },
    );
  }

  const updated = await updateHumanName(user._id, name);
  if (!updated) {
    return data(
      { intent: "update-name" as const, error: "Failed to update name." },
      { status: 500 },
    );
  }

  const setCookie = await updateUserSession(request, updated);
  return data(
    { intent: "update-name" as const, success: true, human: updated },
    { headers: { "Set-Cookie": setCookie } },
  );
}

async function handleRequestEmailChange(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const mode = form.get("mode") === "primary" ? "primary" : "alias";

  if (!email || !EMAIL_RE.test(email)) {
    return data(
      {
        intent: "request-email-change" as const,
        error: "Please enter a valid email address.",
      },
      { status: 400 },
    );
  }

  const alreadyOwn =
    email === user.email.trim().toLowerCase() ||
    (user.aliasEmails ?? []).includes(email);
  if (alreadyOwn) {
    return data(
      {
        intent: "request-email-change" as const,
        error: "That's already one of your emails.",
      },
      { status: 400 },
    );
  }

  if (await isEmailTakenByAnotherHuman(email, user._id)) {
    return data(
      {
        intent: "request-email-change" as const,
        error: "That email is already in use by another account.",
      },
      { status: 400 },
    );
  }

  const started = await startEmailChange(user._id, email, mode);
  if (!started) {
    return data(
      {
        intent: "request-email-change" as const,
        error: "Failed to start email verification.",
      },
      { status: 500 },
    );
  }

  try {
    await sendEmail({
      to: [email],
      subject: "Confirm your email for Nopal",
      react: ConfirmEmail({ code: started.code, type: mode }),
    });
  } catch (err) {
    console.error("Failed to send email confirmation code:", err);
    return data(
      {
        intent: "request-email-change" as const,
        error: "Failed to send the confirmation email. Please try again.",
      },
      { status: 502 },
    );
  }

  const setCookie = await updateUserSession(request, started.human);
  return data(
    { intent: "request-email-change" as const, success: true, human: started.human },
    { headers: { "Set-Cookie": setCookie } },
  );
}

async function handleVerifyEmailChange(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const code = String(form.get("code") ?? "").trim();

  if (!isPendingEmailCodeValid(user)) {
    return data(
      {
        intent: "verify-email-change" as const,
        error: "That code has expired. Request a new one.",
      },
      { status: 400 },
    );
  }

  if (code !== user.pendingEmailCode) {
    const { attemptsRemaining } = await recordFailedEmailCodeAttempt(user);
    return data(
      {
        intent: "verify-email-change" as const,
        error:
          attemptsRemaining > 0
            ? `That code isn't right. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} left.`
            : "Too many incorrect attempts. Request a new code.",
      },
      { status: 400 },
    );
  }

  // Re-check availability right before applying, in case someone else
  // claimed the address while this code was pending.
  if (await isEmailTakenByAnotherHuman(user.pendingEmail!, user._id)) {
    await clearPendingEmailChange(user._id);
    return data(
      {
        intent: "verify-email-change" as const,
        error: "That email is now in use by another account.",
      },
      { status: 400 },
    );
  }

  const pendingType = user.pendingEmailType;
  const pendingEmail = user.pendingEmail!;
  const updated = await applyPendingEmailChange(user);
  if (!updated) {
    return data(
      {
        intent: "verify-email-change" as const,
        error: "Failed to confirm email.",
      },
      { status: 500 },
    );
  }

  // Notify the address that was already on the account (not the one that
  // just got added), so account changes always leave a trail somewhere an
  // attacker with a hijacked session wouldn't control. Best-effort: the
  // email/alias change itself has already succeeded above, so a notice
  // delivery hiccup shouldn't fail the whole confirmation (and shouldn't
  // force the user to retry, re-applying an already-applied change).
  try {
    await sendEmail({
      to: [user.email.trim().toLowerCase()],
      subject: "Your Nopal account's login email changed",
      react: EmailChangeNotice({
        changedEmail: pendingEmail,
        reason: pendingType === "primary" ? "primary-changed" : "alias-added",
      }),
    });
  } catch (err) {
    console.error("Failed to send email change notice:", err);
  }

  const setCookie = await updateUserSession(request, updated);
  return data(
    { intent: "verify-email-change" as const, success: true, human: updated },
    { headers: { "Set-Cookie": setCookie } },
  );
}

async function handleCancelEmailChange(request: Request) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  await clearPendingEmailChange(user._id);
  const updated = { ...user };
  delete updated.pendingEmail;
  delete updated.pendingEmailType;
  delete updated.pendingEmailCode;
  delete updated.pendingEmailCodeExpiresAt;
  delete updated.pendingEmailAttempts;

  const setCookie = await updateUserSession(request, updated);
  return data(
    { intent: "cancel-email-change" as const, success: true, human: updated },
    { headers: { "Set-Cookie": setCookie } },
  );
}

async function handleRemoveAlias(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const aliasEmail = String(form.get("aliasEmail") ?? "")
    .trim()
    .toLowerCase();
  const updated = await removeAliasEmail(user._id, aliasEmail);
  if (!updated) {
    return data(
      { intent: "remove-alias" as const, error: "Failed to remove alias." },
      { status: 500 },
    );
  }

  const setCookie = await updateUserSession(request, updated);
  return data(
    { intent: "remove-alias" as const, success: true, human: updated },
    { headers: { "Set-Cookie": setCookie } },
  );
}

async function handleAddRelationship(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();

  if (!email || !EMAIL_RE.test(email)) {
    return data(
      {
        intent: "add-relationship" as const,
        error: "Please enter a valid email address.",
      },
      { status: 400 },
    );
  }
  if (email === user.email.trim().toLowerCase()) {
    return data(
      { intent: "add-relationship" as const, error: "That's your own email." },
      { status: 400 },
    );
  }

  const existing = await getHumanByEmail(email);

  if (existing) {
    const created = await createRelationship(user._id, existing._id, user._id);
    if (!created) {
      return data(
        {
          intent: "add-relationship" as const,
          error: "You already have a relationship with that human.",
        },
        { status: 400 },
      );
    }
    return data({
      intent: "add-relationship" as const,
      success: true,
      name: existing.name,
      invited: false,
    });
  }

  // No human with that email yet — need a name (and optional note) to invite them.
  if (!name) {
    return data({
      intent: "add-relationship" as const,
      needsInvite: true,
      email,
    });
  }

  const invited = await inviteHuman(
    {
      email,
      name,
      role: "Human",
      inviteNote: note || undefined,
      invitedByHumanId: user._id,
    },
    request,
  );
  if (!invited) {
    return data(
      {
        intent: "add-relationship" as const,
        error: "Failed to invite that person.",
      },
      { status: 500 },
    );
  }

  await createRelationship(user._id, invited._id, user._id);
  return data({
    intent: "add-relationship" as const,
    success: true,
    name: invited.name,
    invited: true,
  });
}

async function handleDeletePasskey(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const passkeyId = String(form.get("passkeyId") ?? "");
  if (!passkeyId) {
    return data(
      { intent: "delete-passkey" as const, error: "Missing passkey id." },
      { status: 400 },
    );
  }

  const passkey = await getPasskeyById(passkeyId);
  if (!passkey || passkey.humanId !== user._id) {
    return data(
      { intent: "delete-passkey" as const, error: "Passkey not found." },
      { status: 404 },
    );
  }

  await deletePasskey(passkeyId);
  return data({ intent: "delete-passkey" as const, success: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "update-name");

  if (intent === "add-relationship") {
    return handleAddRelationship(request, form);
  }
  if (intent === "delete-passkey") {
    return handleDeletePasskey(request, form);
  }
  if (intent === "request-email-change") {
    return handleRequestEmailChange(request, form);
  }
  if (intent === "verify-email-change") {
    return handleVerifyEmailChange(request, form);
  }
  if (intent === "cancel-email-change") {
    return handleCancelEmailChange(request);
  }
  if (intent === "remove-alias") {
    return handleRemoveAlias(request, form);
  }
  return handleUpdateName(request, form);
}

// ─── Waivers ────────────────────────────────────────────────────────────────

function formatSignedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function WaiverCard({ doc }: { doc: LegalDocumentRecord }) {
  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-bold">Signed workers' comp waiver</div>
        <div style={{ color: "var(--text-subtle)" }}>
          Signed {formatSignedAt(doc.signed_at)}
        </div>
      </div>
      <a
        href={doc.s3_url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-mono purple-light-text shrink-0"
        style={{ textDecoration: "none" }}
      >
        Download →
      </a>
    </div>
  );
}

// ─── Relationships ──────────────────────────────────────────────────────────

function RelationshipCard({ human }: { human: Human }) {
  const isAutomatic = isAdminOrSuper(human);
  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-bold">{human.name}</div>
        <div style={{ color: "var(--text-subtle)" }}>{human.email}</div>
      </div>
      {isAutomatic && (
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0"
          style={{
            background: "var(--farground)",
            border: "1px solid var(--midground)",
            color: "var(--text-subtle)",
          }}
        >
          {human.role}
        </span>
      )}
    </div>
  );
}

// ─── Passkeys ───────────────────────────────────────────────────────────────

function PasskeyCard({ passkey }: { passkey: Passkey }) {
  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="font-bold">{passkey.name}</div>
        <div style={{ color: "var(--text-subtle)" }}>
          Added {formatSignedAt(passkey.createdAt)}
        </div>
      </div>
      <Form
        method="post"
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Remove "${passkey.name}"? You'll need another way to sign in from that device.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="intent" value="delete-passkey" />
        <input type="hidden" name="passkeyId" value={passkey._id} />
        <button
          type="submit"
          className="text-sm font-mono red-text shrink-0"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          Remove
        </button>
      </Form>
    </div>
  );
}

export default function Profile() {
  const { user, waivers, relatedHumans, passkeys, inviteExpired } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { revalidate } = useRevalidator();

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchEmailInput, setSwitchEmailInput] = useState("");
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);

  // Remember the current account on this device so it shows up as a quick
  // "switch account" option from other accounts later on.
  useEffect(() => {
    rememberAccount({ email: user.email, name: user.name });
    setKnownAccounts(getKnownAccounts());
  }, [user.email, user.name]);

  function closeSwitchModal() {
    setSwitchModalOpen(false);
    setSwitchError(null);
    setSwitchEmailInput("");
  }

  function handleForgetAccount(email: string) {
    forgetAccount(email);
    setKnownAccounts(getKnownAccounts());
  }

  async function handleSwitchAccount(targetEmail: string) {
    const email = targetEmail.trim();
    if (!email) return;

    setSwitchError(null);
    setSwitchBusy(true);
    try {
      const optionsRes = await fetch("/api/passkeys/login-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
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
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error ?? "Could not verify passkey.");
      }

      // Full reload so every part of the app picks up the new session's user.
      window.location.href = "/fruits";
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled the browser's passkey prompt — not a real error.
        return;
      }
      setSwitchError(
        err instanceof Error
          ? err.message
          : "Something went wrong switching accounts.",
      );
    } finally {
      setSwitchBusy(false);
    }
  }

  async function handleCreatePasskey() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    try {
      const optionsRes = await fetch("/api/passkeys/register-options", {
        method: "POST",
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        throw new Error(options.error ?? "Failed to start passkey registration.");
      }

      const registrationResponse = await startRegistration({
        optionsJSON: options,
      });

      const name =
        window.prompt(
          "Name this passkey (e.g. \"MacBook\" or \"iPhone\")",
          "Passkey",
        ) || "Passkey";

      const verifyRes = await fetch("/api/passkeys/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: registrationResponse, name }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.verified) {
        throw new Error(verifyData.error ?? "Could not verify passkey.");
      }

      revalidate();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        // User cancelled the browser's passkey prompt — not a real error.
        return;
      }
      setPasskeyError(
        err instanceof Error
          ? err.message
          : "Something went wrong creating your passkey.",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  const relationshipResult =
    actionData?.intent === "add-relationship" ? actionData : undefined;
  const passkeyDeleteResult =
    actionData?.intent === "delete-passkey" ? actionData : undefined;
  const nameResult =
    actionData?.intent === "update-name" ? actionData : undefined;
  const emailResult =
    actionData &&
    (actionData.intent === "request-email-change" ||
      actionData.intent === "verify-email-change" ||
      actionData.intent === "cancel-email-change" ||
      actionData.intent === "remove-alias")
      ? actionData
      : undefined;

  const displayUser: Human =
    actionData && "human" in actionData && actionData.human
      ? actionData.human
      : user;

  const [editingName, setEditingName] = useState(false);
  const [editingPrimaryEmail, setEditingPrimaryEmail] = useState(false);
  const [addingAlias, setAddingAlias] = useState(false);

  useEffect(() => {
    if (nameResult && "success" in nameResult) setEditingName(false);
  }, [nameResult]);

  const needsInviteDetails =
    relationshipResult && "needsInvite" in relationshipResult
      ? relationshipResult.needsInvite
      : false;
  const inviteEmail =
    relationshipResult && "email" in relationshipResult
      ? relationshipResult.email
      : "";

  const knownOtherAccounts = knownAccounts.filter(
    (account) => account.email.toLowerCase() !== user.email.toLowerCase(),
  );

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-bold text-2xl mb-1">Personal Profile</h1>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="link text-sm"
              onClick={() => setSwitchModalOpen(true)}
            >
              Switch account
            </button>
            <Link to="/logout" className="link text-sm">
              Log out
            </Link>
          </div>
        </div>
        <p className="text-sm mb-8" style={{ color: "var(--text-subtle)" }}>
          Manage your name, email, and logins.
        </p>

        <Modal
          open={switchModalOpen}
          onClose={closeSwitchModal}
          title="Switch account"
        >
          <div className="flex flex-col gap-4">
            <div className="text-sm" style={{ color: "var(--text-subtle)" }}>
              You're logged in as <strong>{user.email}</strong>.
            </div>

            {switchError && (
              <div className="red-text text-sm">{switchError}</div>
            )}

            {knownOtherAccounts.length > 0 && (
              <div className="flex flex-col gap-2">
                <div
                  className="text-sm"
                  style={{ color: "var(--text-subtle)" }}
                >
                  Known accounts on this device
                </div>
                {knownOtherAccounts.map((account) => (
                  <div
                    key={account.email}
                    className="good-box p-2 flex items-center justify-between gap-2"
                  >
                    <button
                      type="button"
                      className="text-left text-sm flex-1"
                      disabled={switchBusy}
                      onClick={() => handleSwitchAccount(account.email)}
                    >
                      <div className="font-bold">{account.name}</div>
                      <div style={{ color: "var(--text-subtle)" }}>
                        {account.email}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="link text-sm"
                      disabled={switchBusy}
                      aria-label={`Remove ${account.email}`}
                      onClick={() => handleForgetAccount(account.email)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSwitchAccount(switchEmailInput);
              }}
            >
              <Input
                label={
                  knownOtherAccounts.length > 0
                    ? "Or switch to a different email"
                    : "Email"
                }
                name="switch-email"
                value={switchEmailInput}
                onChange={(e) => setSwitchEmailInput(e.target.value)}
                placeholder="you@nature.yeah"
                autoFocus={knownOtherAccounts.length === 0}
              />
              <div className="text-right">
                <button
                  className="btn-secondary"
                  type="submit"
                  disabled={switchBusy || !switchEmailInput.trim()}
                >
                  {switchBusy ? "Switching…" : "Continue"}
                </button>
              </div>
            </form>
          </div>
        </Modal>

        {inviteExpired && (
          <div
            className="good-box p-3 text-sm mb-6"
            style={{ color: "var(--text-subtle)" }}
          >
            That passkey setup link had already expired or been used, so no
            changes were made. You can add a passkey below instead.
          </div>
        )}

        {/* ── Name ───────────────────────────────────────────────────────── */}
        <div className="good-box p-4 flex flex-col gap-2">
          <label className="purple-text font-bold text-sm">Name</label>
          {editingName ? (
            <Form method="post" className="flex items-center gap-2">
              <input type="hidden" name="intent" value="update-name" />
              <div className="flex-1">
                <Input
                  label="Name"
                  hideLabel
                  name="name"
                  defaultValue={displayUser.name}
                  required
                  autoFocus
                />
              </div>
              <button className="btn-secondary" type="submit">
                Save
              </button>
              <button
                className="link"
                type="button"
                onClick={() => setEditingName(false)}
              >
                Cancel
              </button>
            </Form>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span>{displayUser.name}</span>
              <button
                className="link text-sm"
                type="button"
                onClick={() => setEditingName(true)}
              >
                Edit
              </button>
            </div>
          )}
          {nameResult && "error" in nameResult && (
            <div className="red-text text-sm">{nameResult.error}</div>
          )}
        </div>

        {/* ── Email ──────────────────────────────────────────────────────── */}
        <div className="good-box p-4 flex flex-col gap-3 mt-4">
          <label className="purple-text font-bold text-sm">Email</label>

          {displayUser.pendingEmail ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                We sent a code to <strong>{displayUser.pendingEmail}</strong>.
                Enter it below to{" "}
                {displayUser.pendingEmailType === "primary"
                  ? "make it your primary email"
                  : "add it as a login"}
                .
              </p>
              <Form method="post" className="flex items-center gap-2">
                <input type="hidden" name="intent" value="verify-email-change" />
                <div className="flex-1">
                  <Input
                    label="Verification code"
                    hideLabel
                    name="code"
                    required
                    autoFocus
                    placeholder="123456"
                  />
                </div>
                <button className="btn-secondary" type="submit">
                  Confirm
                </button>
              </Form>
              <div className="flex items-center gap-4 text-sm">
                <Form method="post">
                  <input type="hidden" name="intent" value="request-email-change" />
                  <input type="hidden" name="email" value={displayUser.pendingEmail} />
                  <input
                    type="hidden"
                    name="mode"
                    value={displayUser.pendingEmailType}
                  />
                  <button className="link" type="submit">
                    Resend code
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="cancel-email-change" />
                  <button className="link" type="submit">
                    Cancel
                  </button>
                </Form>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <span>{displayUser.email}</span>
                <button
                  className="link text-sm"
                  type="button"
                  onClick={() => setEditingPrimaryEmail((v) => !v)}
                >
                  Edit
                </button>
              </div>
              {editingPrimaryEmail && (
                <Form method="post" className="flex items-center gap-2">
                  <input type="hidden" name="intent" value="request-email-change" />
                  <input type="hidden" name="mode" value="primary" />
                  <div className="flex-1">
                    <Input
                      label="New email"
                      hideLabel
                      name="email"
                      required
                      autoFocus
                      placeholder="new@email.com"
                    />
                  </div>
                  <button className="btn-secondary" type="submit">
                    Send code
                  </button>
                  <button
                    className="link"
                    type="button"
                    onClick={() => setEditingPrimaryEmail(false)}
                  >
                    Cancel
                  </button>
                </Form>
              )}
            </>
          )}

          {emailResult && "error" in emailResult && (
            <div className="red-text text-sm">{emailResult.error}</div>
          )}

          {!displayUser.pendingEmail &&
            (displayUser.aliasEmails ?? []).length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-bold purple-text">
                  Also signs in with
                </div>
                {(displayUser.aliasEmails ?? []).map((aliasEmail) => (
                  <div
                    key={aliasEmail}
                    className="good-box p-2 flex items-center justify-between gap-2 text-sm"
                  >
                    <span>{aliasEmail}</span>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (
                          !window.confirm(
                            `Remove ${aliasEmail}? It will no longer sign in to this account.`,
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="remove-alias" />
                      <input type="hidden" name="aliasEmail" value={aliasEmail} />
                      <button
                        type="submit"
                        className="text-sm font-mono red-text shrink-0"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Remove
                      </button>
                    </Form>
                  </div>
                ))}
              </div>
            )}

          {!displayUser.pendingEmail &&
            (addingAlias ? (
              <Form method="post" className="flex items-center gap-2">
                <input type="hidden" name="intent" value="request-email-change" />
                <input type="hidden" name="mode" value="alias" />
                <div className="flex-1">
                  <Input
                    label="Alias email"
                    hideLabel
                    name="email"
                    required
                    autoFocus
                    placeholder="alias@email.com"
                  />
                </div>
                <button className="btn-secondary" type="submit">
                  Send code
                </button>
                <button
                  className="link"
                  type="button"
                  onClick={() => setAddingAlias(false)}
                >
                  Cancel
                </button>
              </Form>
            ) : (
              <div className="text-right">
                <button
                  className="link text-sm"
                  type="button"
                  onClick={() => setAddingAlias(true)}
                >
                  + Add alias email
                </button>
              </div>
            ))}
        </div>

        {/* ── Relationships ─────────────────────────────────────────────── */}
        <div className="mt-10">
          <h2 className="font-bold text-lg mb-1">Relationships</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-subtle)" }}>
            {isAdminOrSuper(user)
              ? "As an Admin/Super, you can see and share vault folders with everyone."
              : "Humans you have a relationship with can share vault folders with you, and vice versa. Admins and Supers can always see you."}
          </p>

          {relatedHumans.length === 0 ? (
            <div
              className="good-box p-3 text-sm mb-4"
              style={{ color: "var(--text-subtle)" }}
            >
              No relationships yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-4">
              {relatedHumans.map((human) => (
                <RelationshipCard key={human._id} human={human} />
              ))}
            </div>
          )}

          <Form
            method="post"
            key={
              relationshipResult ? JSON.stringify(relationshipResult) : "new"
            }
            className="flex flex-col gap-4 good-box p-4"
          >
            <input type="hidden" name="intent" value="add-relationship" />
            <Input
              label="Email"
              name="email"
              defaultValue={needsInviteDetails ? inviteEmail : ""}
              required
              placeholder="human@example.com"
            />

            {needsInviteDetails && (
              <>
                <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                  We don't have an account for that email yet. Give us their
                  name and we'll invite them.
                </p>
                <Input label="Name" name="name" required placeholder="Their name" />
                <Input
                  type="textarea"
                  label="Invite note (optional)"
                  name="note"
                  placeholder="Let them know why you're adding them"
                />
              </>
            )}

            {relationshipResult && "error" in relationshipResult && (
              <div className="red-text text-sm">{relationshipResult.error}</div>
            )}
            {relationshipResult && "success" in relationshipResult && (
              <div className="text-sm" style={{ color: "var(--green)" }}>
                {relationshipResult.invited
                  ? `Invited ${relationshipResult.name} and added the relationship.`
                  : `Added ${relationshipResult.name}.`}
              </div>
            )}

            <div className="text-right">
              <button className="btn-secondary" type="submit">
                {needsInviteDetails ? "Send Invite" : "Add"}
              </button>
            </div>
          </Form>
        </div>

        {/* ── Passkeys ──────────────────────────────────────────────────── */}
        <div className="mt-10">
          <h2 className="font-bold text-lg mb-1">Passkeys</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-subtle)" }}>
            Sign in with your device's fingerprint, face, or PIN instead of an
            email code.
          </p>

          {passkeys.length === 0 ? (
            <div
              className="good-box p-3 text-sm mb-4"
              style={{ color: "var(--text-subtle)" }}
            >
              No passkeys yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-4">
              {passkeys.map((passkey) => (
                <PasskeyCard key={passkey._id} passkey={passkey} />
              ))}
            </div>
          )}

          {passkeyError && (
            <div className="red-text text-sm mb-4">{passkeyError}</div>
          )}
          {passkeyDeleteResult && "error" in passkeyDeleteResult && (
            <div className="red-text text-sm mb-4">
              {passkeyDeleteResult.error}
            </div>
          )}

          <div className="text-right">
            <button
              className="btn-secondary"
              type="button"
              disabled={passkeyBusy}
              onClick={handleCreatePasskey}
            >
              {passkeyBusy ? "Creating…" : "+ Create a passkey"}
            </button>
          </div>
        </div>

        {/* ── Workers' Comp Waiver ──────────────────────────────────────── */}
        <div className="mt-10">
          <h2 className="font-bold text-lg mb-1">Workers' Comp Waiver</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-subtle)" }}>
            {waivers.length > 0
              ? "Here's your signed waiver. You can sign a new one at any time."
              : "You haven't signed a workers' compensation waiver yet."}
          </p>

          {waivers.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              {waivers.map((doc) => (
                <WaiverCard key={doc.s3_key} doc={doc} />
              ))}
            </div>
          )}

          <Link
            to={`/docs/wc-waiver?name=${encodeURIComponent(
              displayUser.name,
            )}&email=${encodeURIComponent(displayUser.email)}`}
            className="text-sm font-mono purple-light-text"
          >
            Sign a new waiver →
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
