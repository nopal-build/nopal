// app/routes/fruits_.profile.tsx
import { useState, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  useFetcher,
  Form,
  Link,
} from "react-router";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { getUser, updateUserSession } from "../modules/auth/auth.server";
import {
  getHumanByEmail,
  getHumanById,
  updateHumanName,
  isEmailTakenByAnotherHuman,
  startEmailChange,
  isPendingEmailCodeValid,
  clearPendingEmailChange,
  recordFailedEmailCodeAttempt,
  applyPendingEmailChange,
  removeAliasEmail,
  type Human,
  type Role,
} from "../data/humans.server";
import { sendEmail } from "../util/email.server";
import { ConfirmEmail } from "../emails/confirmEmail";
import { EmailChangeNotice } from "../emails/emailChangeNotice";
import {
  createRelationship,
  revokeRelationship,
  relationshipExists,
  getRelatedHumans,
  getRelationshipsForHuman,
} from "../data/relationships.server";
import {
  inviteHuman,
  canResendInvite,
  resendInvite,
} from "../data/invites.server";
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
import {
  getApiTokensByHuman,
  revokeApiToken,
  type ApiToken,
} from "../data/apiTokens.server";
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
  const [waivers, relatedHumans, passkeys, relationships, apiTokens] =
    await Promise.all([
      getLegalDocumentsByEmail(user.email),
      getRelatedHumans(user),
      getPasskeysByHuman(user._id),
      getRelationshipsForHuman(user._id),
      getApiTokensByHuman(user._id),
    ]);

  // Revoked relationships are excluded from `relatedHumans` for regular
  // Human accounts, but Admins/Supers see *everyone* regardless of
  // relationship state — so without this, revoking someone from an
  // admin account would look like it did nothing. Map otherHumanId ->
  // whoever revoked it, so the UI can show a distinct "Revoked" state
  // instead of rendering the row as if nothing had ever happened.
  const revokedRelationships: Record<string, string> = {};
  for (const r of relationships) {
    if (!r.revokedAt || !r.revokedBy) continue;
    const otherId = r.humanAId === user._id ? r.humanBId : r.humanAId;
    revokedRelationships[otherId] = r.revokedBy;
  }

  const url = new URL(request.url);
  const inviteExpired = url.searchParams.get("inviteExpired") === "1";
  return {
    user,
    waivers,
    relatedHumans,
    passkeys,
    apiTokens,
    inviteExpired,
    revokedRelationships,
  };
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
    {
      intent: "request-email-change" as const,
      success: true,
      human: started.human,
    },
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
    const result = await createRelationship(user._id, existing._id, user._id);
    if (result.status === "already-related") {
      return data(
        {
          intent: "add-relationship" as const,
          error: "You already have a relationship with that human.",
        },
        { status: 400 },
      );
    }
    if (result.status === "revoked-by-other") {
      return data(
        {
          intent: "add-relationship" as const,
          error:
            "This relationship was revoked. Only the person who revoked it can reconnect.",
        },
        { status: 403 },
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

async function handleResendInvite(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const humanId = String(form.get("humanId") ?? "");
  if (!humanId) {
    return data(
      { intent: "resend-invite" as const, error: "Missing human id.", humanId },
      { status: 400 },
    );
  }

  if (!isAdminOrSuper(user) && !(await relationshipExists(user._id, humanId))) {
    return data(
      {
        intent: "resend-invite" as const,
        error: "That person could not be found.",
        humanId,
      },
      { status: 404 },
    );
  }

  const target = await getHumanById(humanId);
  if (!target) {
    return data(
      {
        intent: "resend-invite" as const,
        error: "That person could not be found.",
        humanId,
      },
      { status: 404 },
    );
  }

  if (!canResendInvite(target)) {
    return data(
      {
        intent: "resend-invite" as const,
        error:
          "An invite was just sent \u2014 please wait a minute before resending.",
        humanId,
      },
      { status: 429 },
    );
  }

  const resent = await resendInvite(target, request);
  if (!resent) {
    return data(
      {
        intent: "resend-invite" as const,
        error: "Failed to resend the invite.",
        humanId,
      },
      { status: 500 },
    );
  }

  return data({
    intent: "resend-invite" as const,
    success: true,
    name: resent.name,
    humanId,
  });
}

async function handleRevokeRelationship(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const humanId = String(form.get("humanId") ?? "");
  if (!humanId || humanId === user._id) {
    return data(
      {
        intent: "revoke-relationship" as const,
        error: "Invalid request.",
        humanId,
      },
      { status: 400 },
    );
  }

  await revokeRelationship(user._id, humanId, user._id);
  return data({
    intent: "revoke-relationship" as const,
    success: true,
    humanId,
  });
}

async function handleRekindleRelationship(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const humanId = String(form.get("humanId") ?? "");
  if (!humanId || humanId === user._id) {
    return data(
      {
        intent: "rekindle-relationship" as const,
        error: "Invalid request.",
        humanId,
      },
      { status: 400 },
    );
  }

  const result = await createRelationship(user._id, humanId, user._id);
  if (result.status === "revoked-by-other") {
    return data(
      {
        intent: "rekindle-relationship" as const,
        error: "Only the person who revoked this relationship can reconnect.",
        humanId,
      },
      { status: 403 },
    );
  }

  return data({
    intent: "rekindle-relationship" as const,
    success: true,
    humanId,
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

async function handleRevokeApiToken(request: Request, form: FormData) {
  const user = await getUser(request);
  if (!user) return redirect("/login");

  const tokenId = String(form.get("tokenId") ?? "");
  if (!tokenId) {
    return data(
      { intent: "revoke-api-token" as const, error: "Missing token id." },
      { status: 400 },
    );
  }

  // `revokeApiToken` itself checks the token belongs to `user._id` before
  // touching anything — mirrors the passkey/relationship ownership checks.
  const revoked = await revokeApiToken(tokenId, user._id);
  if (!revoked) {
    return data(
      { intent: "revoke-api-token" as const, error: "Token not found." },
      { status: 404 },
    );
  }

  return data({ intent: "revoke-api-token" as const, success: true });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "update-name");

  if (intent === "add-relationship") {
    return handleAddRelationship(request, form);
  }
  if (intent === "resend-invite") {
    return handleResendInvite(request, form);
  }
  if (intent === "revoke-relationship") {
    return handleRevokeRelationship(request, form);
  }
  if (intent === "rekindle-relationship") {
    return handleRekindleRelationship(request, form);
  }
  if (intent === "delete-passkey") {
    return handleDeletePasskey(request, form);
  }
  if (intent === "revoke-api-token") {
    return handleRevokeApiToken(request, form);
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
      <div className="text-sm min-w-0">
        <div className="font-bold truncate">Signed workers' comp waiver</div>
        <div className="truncate" style={{ color: "var(--text-subtle)" }}>
          Signed {formatSignedAt(doc.signed_at)}
        </div>
      </div>
      <a
        href={`/api/legal-documents/view/${doc._id}`}
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

// Mirrors the cooldown in invites.server.ts's `canResendInvite` — used only
// to disable the button client-side; the server re-validates regardless.
const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;

function hasPendingInvite(human: Human): boolean {
  return Boolean(human.inviteToken);
}

function inviteResendReady(human: Human): boolean {
  if (!human.inviteSentAt) return true;
  return (
    Date.now() - new Date(human.inviteSentAt).getTime() >=
    INVITE_RESEND_COOLDOWN_MS
  );
}

function RelationshipCard({
  human,
  viewerId,
  viewerRole,
  revokedBy,
  background,
  onImpersonate,
}: {
  human: Human;
  /** The logged-in user's own id — used to tell "you revoked them" apart from "they revoked you". */
  viewerId: string;
  /** The logged-in user's own role — governs whether "Login as user" can target this row (Admins can't view as other Admins/Supers; Supers can view as anyone). */
  viewerRole: Role;
  /** If this pair has a revoked relationship, the id of whoever revoked it. */
  revokedBy?: string;
  /** Overrides `.good-box`'s default background — e.g. white cards inside a colored container. */
  background?: string;
  /** Present only when the viewer is an Admin/Super — powers the per-row "..." "Login as user" menu. Rejects (rather than navigating away) on failure. */
  onImpersonate?: (human: Human) => Promise<void>;
}) {
  const isAutomatic = isAdminOrSuper(human);
  const revoked = Boolean(revokedBy);
  const revokedByViewer = revokedBy === viewerId;
  const pendingInvite = !isAutomatic && !revoked && hasPendingInvite(human);
  const resendReady = inviteResendReady(human);
  const [confirmRevokeOpen, setConfirmRevokeOpen] = useState(false);

  // Mirrors canImpersonate() server-side: Admins can only log in as regular
  // accounts, never other admins/supers; Supers can log in as anyone.
  const canImpersonateRow =
    Boolean(onImpersonate) && (viewerRole === "Super" || !isAutomatic);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  async function handleLoginAsUser() {
    if (!onImpersonate) return;
    setMenuOpen(false);
    setImpersonateError(null);
    setImpersonating(true);
    try {
      await onImpersonate(human);
    } catch (err) {
      setImpersonateError(
        err instanceof Error
          ? err.message
          : "Something went wrong logging in as that account.",
      );
      setImpersonating(false);
    }
  }

  // A dedicated fetcher (rather than a nested <Form>) — this card can be
  // rendered inside the Relationships section's own outer <Form> (for the
  // "add by email" flow), and nested <form> elements are invalid HTML that
  // browsers silently "fix" by misrouting the submission.
  const resendFetcher = useFetcher<typeof action>();
  const resendData =
    resendFetcher.data?.intent === "resend-invite"
      ? resendFetcher.data
      : undefined;
  const resending = resendFetcher.state !== "idle";

  function submitResend() {
    resendFetcher.submit(
      { intent: "resend-invite", humanId: human._id },
      { method: "post" },
    );
  }

  // A dedicated fetcher (rather than a nested <Form>) so the revoke submit
  // button inside the modal doesn't depend on a native form-submit event
  // bubbling correctly through the modal's own click-handling; it's also
  // scoped to this card, so its result never needs matching up by id.
  const revokeFetcher = useFetcher<typeof action>();
  const revokeData =
    revokeFetcher.data?.intent === "revoke-relationship"
      ? revokeFetcher.data
      : undefined;
  const revoking = revokeFetcher.state !== "idle";
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (revokeData && "success" in revokeData) {
      setConfirmRevokeOpen(false);
      // Fetcher submissions revalidate loaders automatically in most cases,
      // but force it explicitly so the revoked human reliably disappears
      // from `relatedHumans` without depending on that default behavior.
      revalidate();
    }
  }, [revokeData, revalidate]);

  function submitRevoke() {
    revokeFetcher.submit(
      { intent: "revoke-relationship", humanId: human._id },
      { method: "post" },
    );
  }

  // Lets whoever revoked a relationship reconnect with a single click,
  // right from the row — rather than having to retype the person's email
  // into the "Add relationship" form below.
  const rekindleFetcher = useFetcher<typeof action>();
  const rekindleData =
    rekindleFetcher.data?.intent === "rekindle-relationship"
      ? rekindleFetcher.data
      : undefined;
  const rekindling = rekindleFetcher.state !== "idle";

  useEffect(() => {
    if (rekindleData && "success" in rekindleData) revalidate();
  }, [rekindleData, revalidate]);

  function submitRekindle() {
    rekindleFetcher.submit(
      { intent: "rekindle-relationship", humanId: human._id },
      { method: "post" },
    );
  }

  return (
    <div
      className="good-box p-3 flex items-center justify-between gap-4"
      style={background ? { background } : undefined}
    >
      <div
        className="text-sm min-w-0"
        style={revoked ? { opacity: 0.5, filter: "grayscale(0.6)" } : undefined}
      >
        <div
          className="font-bold truncate"
          style={background ? { color: "var(--purple)" } : undefined}
        >
          {human.name}
        </div>
        <div className="truncate" style={{ color: "var(--text-subtle)" }}>
          {human.email}
        </div>
        {resendData && "error" in resendData && (
          <div className="red-text">{resendData.error}</div>
        )}
        {resendData && "success" in resendData && (
          <div style={{ color: "var(--green)" }}>Invite resent.</div>
        )}
        {rekindleData && "error" in rekindleData && (
          <div className="red-text">{rekindleData.error}</div>
        )}
        {impersonateError && (
          <div className="red-text">{impersonateError}</div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {isAutomatic && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              background: "var(--farground)",
              border: "1px solid var(--midground)",
              color: "var(--text-subtle)",
            }}
          >
            {human.role}
          </span>
        )}

        {pendingInvite && (
          <>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "var(--farground)",
                border: "1px solid var(--midground)",
                color: "var(--text-subtle)",
              }}
            >
              Invited
            </span>
            <button
              type="button"
              disabled={!resendReady || resending}
              className="text-sm font-mono purple-light-text"
              style={{
                background: "none",
                border: "none",
                cursor: resendReady && !resending ? "pointer" : "default",
                padding: 0,
                opacity: resendReady && !resending ? 1 : 0.5,
              }}
              title={
                resendReady
                  ? undefined
                  : "An invite was sent recently — try again shortly."
              }
              onClick={submitResend}
            >
              {resending ? "Resending…" : "Resend"}
            </button>
          </>
        )}

        {revoked && (
          <>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background: "var(--farground)",
                border: "1px solid var(--red)",
                color: "var(--red)",
                opacity: 0.5,
                filter: "grayscale(0.6)",
              }}
              title={
                revokedByViewer
                  ? "You revoked this relationship."
                  : `${human.name} revoked this relationship — only they can reconnect.`
              }
            >
              {revokedByViewer ? "Revoked" : "Revoked by them"}
            </span>
            {revokedByViewer && (
              <button
                type="button"
                disabled={rekindling}
                className="text-sm font-mono green-text"
                style={{
                  background: "none",
                  border: "none",
                  cursor: rekindling ? "default" : "pointer",
                  padding: 0,
                  opacity: rekindling ? 0.5 : 1,
                }}
                onClick={submitRekindle}
              >
                {rekindling ? "Re-kindling…" : "Re-kindle"}
              </button>
            )}
          </>
        )}

        {!isAutomatic && !revoked && (
          <>
            <button
              type="button"
              className="text-sm font-mono red-text"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={() => setConfirmRevokeOpen(true)}
            >
              Revoke
            </button>

            <Modal
              open={confirmRevokeOpen}
              onClose={() => setConfirmRevokeOpen(false)}
              title="Revoke relationship"
            >
              <div className="flex flex-col gap-4">
                <p className="text-sm">
                  Revoke your relationship with <strong>{human.name}</strong>?
                </p>
                <p className="text-sm">
                  This immediately unshares any vault folders you two have
                  shared with each other. This cannot be undone.
                </p>
                <p className="text-sm">
                  Additionally, neither you nor {human.name} will be able to
                  share folders with each other in the future, and only you will
                  be able to re-kindle the relationship.
                </p>
                {revokeData && "error" in revokeData && (
                  <div className="red-text text-sm">{revokeData.error}</div>
                )}
                <div className="flex items-center justify-end gap-4">
                  <button
                    type="button"
                    className="link text-sm"
                    disabled={revoking}
                    onClick={() => setConfirmRevokeOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={revoking}
                    style={
                      { "--btn-color": "var(--red)" } as React.CSSProperties
                    }
                    onClick={submitRevoke}
                  >
                    {revoking ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              </div>
            </Modal>
          </>
        )}

        {canImpersonateRow && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`Manage ${human.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={impersonating}
              onClick={() => setMenuOpen((o) => !o)}
              className="text-sm font-mono"
              style={{
                background: "none",
                border: "none",
                cursor: impersonating ? "default" : "pointer",
                padding: "0 4px",
                color: "var(--text-subtle)",
                fontWeight: 700,
              }}
            >
              {impersonating ? "Logging in…" : "…"}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="good-box"
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 4px)",
                  minWidth: "160px",
                  zIndex: 20,
                  padding: "4px",
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLoginAsUser}
                  className="text-sm text-left purple-text"
                  style={{
                    display: "block",
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "8px 10px",
                    borderRadius: "4px",
                  }}
                >
                  Login as user
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Passkeys ───────────────────────────────────────────────────────────────

function PasskeyCard({ passkey }: { passkey: Passkey }) {
  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm min-w-0">
        <div className="font-bold truncate">{passkey.name}</div>
        <div className="truncate" style={{ color: "var(--text-subtle)" }}>
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
  );
}

// ─── CLI sessions ────────────────────────────────────────────────────────────────

function ApiTokenCard({ token }: { token: ApiToken }) {
  const expired = new Date(token.expiresAt).getTime() < Date.now();

  return (
    <div className="good-box p-3 flex items-center justify-between gap-4">
      <div className="text-sm min-w-0">
        <div className="font-bold truncate">{token.name}</div>
        <div className="truncate" style={{ color: "var(--text-subtle)" }}>
          Added {formatSignedAt(token.createdAt)}
          {" · "}
          {token.lastUsedAt
            ? `Last used ${formatSignedAt(token.lastUsedAt)}`
            : "Never used"}
          {" · "}
          <span className={expired ? "red-text" : undefined}>
            {expired ? "Expired" : `Expires ${formatSignedAt(token.expiresAt)}`}
          </span>
        </div>
      </div>
      <Form
        method="post"
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Revoke "${token.name}"? Any CLI session using it will need to run \`nopal login\` again.`,
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="intent" value="revoke-api-token" />
        <input type="hidden" name="tokenId" value={token._id} />
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
          Revoke
        </button>
      </Form>
    </div>
  );
}

const PROFILE_SECTIONS = [
  { id: "basic", label: "Basic" },
  { id: "relationships", label: "Relationships" },
  { id: "security", label: "Security" },
  { id: "waivers", label: "Waivers" },
] as const;

export default function Profile() {
  const {
    user,
    waivers,
    relatedHumans,
    passkeys,
    apiTokens,
    inviteExpired,
    revokedRelationships,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { revalidate } = useRevalidator();

  // The relationships email input does double duty: it filters the visible
  // cards live as you type, and doubles as the "add relationship" field —
  // submitting it adds/invites whatever email is currently typed. The
  // search runs across the whole list (active + revoked) rather than
  // treating revoked ones as a separate, unsearchable group — they just
  // always sort to the end, under their own heading.
  const [emailQuery, setEmailQuery] = useState("");
  const normalizedEmailQuery = emailQuery.trim().toLowerCase();
  const filteredRelatedHumans = normalizedEmailQuery
    ? relatedHumans.filter((human) =>
        human.email.toLowerCase().includes(normalizedEmailQuery),
      )
    : relatedHumans;
  const filteredActiveRelatedHumans = filteredRelatedHumans.filter(
    (human) => !revokedRelationships[human._id],
  );
  const filteredRevokedRelatedHumans = filteredRelatedHumans.filter(
    (human) => revokedRelationships[human._id],
  );
  const emailQueryLooksValid = EMAIL_RE.test(emailQuery.trim());
  // A valid, typed-out email with no existing relationship for it at all —
  // show an "Add" card in place of the (empty) results instead of just a
  // dead end.
  const emailQueryHasNoMatch = !relatedHumans.some(
    (human) => human.email.toLowerCase() === normalizedEmailQuery,
  );
  const showAddCard = emailQueryLooksValid && emailQueryHasNoMatch;

  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  const [switchModalOpen, setSwitchModalOpen] = useState(false);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchEmailInput, setSwitchEmailInput] = useState("");
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);

  // ── Admin/Super "login as user" ──────────────────────────────────────────
  // Lives as a per-row "..." menu on each RelationshipCard below (Admins and
  // Supers already see *every* human there via `getRelatedHumans`), rather
  // than a separate search UI — the Relationships section's own list and
  // email filter double as the account picker.
  const isManager = isAdminOrSuper(user);

  async function impersonate(target: Human): Promise<void> {
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId: target._id }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error ?? "Could not log in as that account.");
    }
    // So this account shows up as a one-click option in "Switch account"
    // next time — tagged as impersonation so it switches back via this
    // same endpoint rather than a passkey prompt.
    rememberAccount({
      email: target.email,
      name: target.name,
      via: "impersonation",
    });
    window.location.href = "/fruits";
  }

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

  async function handleSwitchAccount(
    targetEmail: string,
    via?: KnownAccount["via"],
  ) {
    const email = targetEmail.trim();
    if (!email) return;

    setSwitchError(null);
    setSwitchBusy(true);
    try {
      // Accounts reached via "Login as user" never had a passkey handed to
      // this admin — switching back to them re-runs the impersonation
      // endpoint instead of a WebAuthn prompt. The server independently
      // re-checks that *this* session is still Admin/Super, so a stale or
      // tampered `via` tag can't grant anything on its own.
      if (via === "impersonation") {
        const res = await fetch("/api/admin/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error ?? "Could not log in as that account.");
        }
        window.location.href = "/fruits";
        return;
      }

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
        throw new Error(
          options.error ?? "Failed to start passkey registration.",
        );
      }

      const registrationResponse = await startRegistration({
        optionsJSON: options,
      });

      const name =
        window.prompt(
          'Name this passkey (e.g. "MacBook" or "iPhone")',
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
  const apiTokenRevokeResult =
    actionData?.intent === "revoke-api-token" ? actionData : undefined;
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

  const [activeSection, setActiveSection] =
    useState<(typeof PROFILE_SECTIONS)[number]["id"]>("basic");

  // Scroll-spy: highlight whichever section header is currently nearest the
  // top of the viewport. The shrunk "effective viewport" (via rootMargin)
  // means a section only counts once it's scrolled up near the top, rather
  // than as soon as any sliver of it appears at the bottom.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveSection(
            visible[0].target.id as (typeof PROFILE_SECTIONS)[number]["id"],
          );
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );

    const elements = PROFILE_SECTIONS.map((section) =>
      document.getElementById(section.id),
    ).filter((el): el is HTMLElement => el !== null);
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <AppLayout>
      <div
        className="container mx-auto px-4 pt-12 pb-[200px]"
        style={{ maxWidth: "1100px" }}
      >
        <h1 className="font-bold text-2xl mb-1">Personal Profile</h1>
        <p className="text-sm mb-4" style={{ color: "var(--text-subtle)" }}>
          Manage your name, email, and logins.
        </p>

        {/* Switch account / Logout live together in the section nav on md+
            screens; that nav is hidden on small screens so the content can
            use the full width, so they need a fallback here on mobile. */}
        <div className="flex items-center gap-4 mb-6 md:hidden">
          <button
            type="button"
            className="link text-sm"
            onClick={() => setSwitchModalOpen(true)}
          >
            Switch account
          </button>
          <Link to="/logout" className="link text-sm">
            Logout
          </Link>
        </div>

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
                      onClick={() =>
                        handleSwitchAccount(account.email, account.via)
                      }
                    >
                      <div className="font-bold">
                        {account.name}
                        {account.via === "impersonation" && (
                          <span
                            className="font-mono"
                            style={{
                              color: "var(--text-subtle)",
                              fontWeight: 400,
                              marginLeft: "6px",
                            }}
                          >
                            (login as user)
                          </span>
                        )}
                      </div>
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

        <div className="flex flex-col md:flex-row gap-8 md:items-start">
          <div className="flex-1 min-w-0 flex flex-col gap-10">
            {/* ── Basic ────────────────────────────────────────────────────── */}
            <section id="basic" className="flex flex-col gap-4">
              <h2 className="font-bold text-lg">Basic</h2>

              <div className="good-box p-4 flex flex-col gap-4">
                {/* ── Name ─────────────────────────────────────────────── */}
                <div className="flex flex-col gap-2">
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
                    <div className="flex items-center gap-2">
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

                <hr style={{ borderColor: "currentColor", opacity: 0.12 }} />

                {/* ── Email ─────────────────────────────────────────── */}
                <div className="flex flex-col gap-3">
                  <label className="purple-text font-bold text-sm">Email</label>

                  {displayUser.pendingEmail ? (
                    <div className="flex flex-col gap-2">
                      <p
                        className="text-sm"
                        style={{ color: "var(--text-subtle)" }}
                      >
                        We sent a code to{" "}
                        <strong>{displayUser.pendingEmail}</strong>. Enter it
                        below to{" "}
                        {displayUser.pendingEmailType === "primary"
                          ? "make it your primary email"
                          : "add it as a login"}
                        .
                      </p>
                      <Form method="post" className="flex items-center gap-2">
                        <input
                          type="hidden"
                          name="intent"
                          value="verify-email-change"
                        />
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
                          <input
                            type="hidden"
                            name="intent"
                            value="request-email-change"
                          />
                          <input
                            type="hidden"
                            name="email"
                            value={displayUser.pendingEmail}
                          />
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
                          <input
                            type="hidden"
                            name="intent"
                            value="cancel-email-change"
                          />
                          <button className="link" type="submit">
                            Cancel
                          </button>
                        </Form>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
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
                          <input
                            type="hidden"
                            name="intent"
                            value="request-email-change"
                          />
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
                              <input
                                type="hidden"
                                name="intent"
                                value="remove-alias"
                              />
                              <input
                                type="hidden"
                                name="aliasEmail"
                                value={aliasEmail}
                              />
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
                        <input
                          type="hidden"
                          name="intent"
                          value="request-email-change"
                        />
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
                      <div>
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
              </div>
            </section>

            {/* ── Relationships ──────────────────────────────────────── */}
            <section id="relationships">
              <h2 className="font-bold text-lg mb-1">Relationships</h2>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-subtle)" }}
              >
                {isAdminOrSuper(user)
                  ? "As an Admin/Super, you can see and share vault folders with everyone."
                  : "Humans you have a relationship with can share vault folders with you, and vice versa. Admins and Supers can always see you."}
              </p>

              {/* Single visual box: fixed-height scrollable relationship
                  list on top (active, then revoked), the search/invite
                  input right below it, separated by a divider. The whole
                  thing is one <Form> so the "Add" card in the results area
                  can submit it directly. */}
              <div className="good-box flex flex-col">
                <Form
                  method="post"
                  key={
                    relationshipResult
                      ? JSON.stringify(relationshipResult)
                      : "new"
                  }
                  className="flex flex-col"
                >
                  <input type="hidden" name="intent" value="add-relationship" />

                  <div
                    className="flex flex-col gap-2 overflow-y-auto p-3"
                    style={{ height: "380px" }}
                  >
                    {showAddCard ? (
                      needsInviteDetails ? (
                        <div
                          className="rounded p-3 flex flex-col gap-3"
                          style={{
                            background: "var(--white)",
                            border: "1px dashed var(--purple-light)",
                          }}
                        >
                          <div
                            className="text-sm font-bold"
                            style={{ color: "var(--purple)" }}
                          >
                            Add {inviteEmail}
                          </div>
                          <Input
                            label="Name"
                            name="name"
                            required
                            placeholder="Their name"
                            autoFocus
                          />
                          <Input
                            type="textarea"
                            label="Invite note (optional)"
                            name="note"
                            placeholder="Let them know why you're adding them"
                          />
                          <div className="text-right">
                            <button className="btn-secondary" type="submit">
                              Send Invite
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="submit"
                          className="rounded p-3 text-sm text-left"
                          style={{
                            background: "var(--white)",
                            border: "1px dashed var(--purple-light)",
                            color: "var(--purple)",
                            cursor: "pointer",
                          }}
                        >
                          <span className="font-bold">
                            + Add {emailQuery.trim()}
                          </span>
                        </button>
                      )
                    ) : filteredActiveRelatedHumans.length === 0 &&
                      filteredRevokedRelatedHumans.length === 0 ? (
                      normalizedEmailQuery ? (
                        <div
                          className="rounded p-3 text-sm"
                          style={{
                            background: "var(--white)",
                            color: "var(--purple)",
                            opacity: 0.5,
                            filter: "grayscale(0.6)",
                          }}
                        >
                          <div className="font-bold">No results</div>
                          <div>
                            Keep typing a full email address to invite them.
                          </div>
                        </div>
                      ) : (
                        <div
                          className="rounded p-3 text-sm"
                          style={{
                            background: "var(--white)",
                            color: "var(--purple)",
                          }}
                        >
                          No relationships yet.
                        </div>
                      )
                    ) : (
                      <>
                        {filteredActiveRelatedHumans.map((human) => (
                          <RelationshipCard
                            key={human._id}
                            human={human}
                            viewerId={user._id}
                            viewerRole={user.role}
                            revokedBy={revokedRelationships[human._id]}
                            background="var(--white)"
                            onImpersonate={isManager ? impersonate : undefined}
                          />
                        ))}

                        {filteredRevokedRelatedHumans.length > 0 && (
                          <>
                            <h3
                              className="font-bold text-sm mt-2"
                              style={{ color: "var(--purple)" }}
                            >
                              Revoked relationships
                            </h3>
                            {filteredRevokedRelatedHumans.map((human) => (
                              <RelationshipCard
                                key={human._id}
                                human={human}
                                viewerId={user._id}
                                viewerRole={user.role}
                                revokedBy={revokedRelationships[human._id]}
                                background="var(--white)"
                                onImpersonate={
                                  isManager ? impersonate : undefined
                                }
                              />
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </div>

                  <hr
                    style={{
                      borderColor: "currentColor",
                      opacity: 0.2,
                      margin: 0,
                    }}
                  />

                  <div className="flex flex-col gap-3 p-3">
                    <div className="relative">
                      <Input
                        label="Email"
                        hideLabel
                        name="email"
                        defaultValue={needsInviteDetails ? inviteEmail : ""}
                        onChange={(e) => setEmailQuery(e.target.value)}
                        required
                        placeholder="Search or invite by email"
                        className="pr-9"
                      />
                      <svg
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="absolute pointer-events-none"
                        style={{
                          right: "10px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          color: "var(--text-subtle)",
                        }}
                      >
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </div>

                    {relationshipResult && "error" in relationshipResult && (
                      <div className="red-text text-sm">
                        {relationshipResult.error}
                      </div>
                    )}
                    {relationshipResult && "success" in relationshipResult && (
                      <div
                        className="text-sm"
                        style={{ color: "var(--green)" }}
                      >
                        {relationshipResult.invited
                          ? `Invited ${relationshipResult.name} and added the relationship.`
                          : `Added ${relationshipResult.name}.`}
                      </div>
                    )}
                  </div>
                </Form>
              </div>
            </section>

            {/* ── Security (Passkeys) ─────────────────────────────────── */}
            <section id="security">
              <h2 className="font-bold text-lg mb-1">Security</h2>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-subtle)" }}
              >
                Sign in with your device's fingerprint, face, or PIN instead of
                an email code.
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

              <h3 className="font-bold mt-6 mb-1">CLI sessions</h3>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-subtle)" }}
              >
                Devices that have signed in with{" "}
                <span className="font-mono">nopal login</span>. Revoke any you
                don't recognize or no longer use — sessions also expire on
                their own after 30 days.
              </p>

              {apiTokens.length === 0 ? (
                <div
                  className="good-box p-3 text-sm mb-4"
                  style={{ color: "var(--text-subtle)" }}
                >
                  No CLI sessions yet.
                </div>
              ) : (
                <div className="flex flex-col gap-2 mb-4">
                  {apiTokens.map((token) => (
                    <ApiTokenCard key={token._id} token={token} />
                  ))}
                </div>
              )}

              {apiTokenRevokeResult && "error" in apiTokenRevokeResult && (
                <div className="red-text text-sm mb-4">
                  {apiTokenRevokeResult.error}
                </div>
              )}
            </section>

            {/* ── Waivers ────────────────────────────────────────── */}
            <section id="waivers">
              <h2 className="font-bold text-lg mb-1">Waivers</h2>
              <p
                className="text-sm mb-4"
                style={{ color: "var(--text-subtle)" }}
              >
                {waivers.length > 0
                  ? "Here's your signed waiver. You can sign a new one at any time."
                  : "You haven't signed a workers' compensation waiver yet."}
              </p>

              {waivers.length > 0 && (
                <div className="flex flex-col gap-2 mb-4">
                  {waivers.map((doc) => (
                    <WaiverCard key={doc._id} doc={doc} />
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
            </section>
          </div>

          {/* ── Section nav ─────────────────────────────────────────────────
              Hidden below md so the content can use the full width instead
              — Switch account/Logout have a fallback under the title for
              that case. Sticky right-hand column on md+ screens. */}
          <nav
            className="hidden md:flex md:flex-col gap-1 w-40 shrink-0 md:sticky"
            style={{ top: "24px" }}
          >
            {PROFILE_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(section.id);
                }}
                className="text-sm py-1 whitespace-nowrap"
                style={{
                  textDecoration: "none",
                  fontWeight: activeSection === section.id ? 700 : 400,
                  color:
                    activeSection === section.id
                      ? "var(--purple)"
                      : "var(--text-subtle)",
                }}
              >
                {section.label}
              </a>
            ))}

            <hr
              className="my-2"
              style={{ borderColor: "currentColor", opacity: 0.12 }}
            />

            <button
              type="button"
              className="text-sm py-1 text-left whitespace-nowrap"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-subtle)",
              }}
              onClick={() => setSwitchModalOpen(true)}
            >
              Switch account
            </button>
            <Link
              to="/logout"
              className="text-sm py-1 whitespace-nowrap"
              style={{ textDecoration: "none", color: "var(--text-subtle)" }}
            >
              Logout
            </Link>
          </nav>
        </div>
      </div>
    </AppLayout>
  );
}
