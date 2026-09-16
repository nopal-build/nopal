import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { sessionStorage } from "./session.server";
import {
  getHumanById,
  getHumanByEmail,
  type Human,
} from "../data/humans.server";
import {
  createPasskey,
  getPasskeysByHuman,
  getPasskeyByCredentialId,
  updatePasskeyCounter,
} from "../data/passkeys.server";

const RP_NAME = "Nopal";

/**
 * The RP ID can be pinned via `WEBAUTHN_RP_ID` so a passkey registered on
 * one hostname (e.g. `nopal.build`) keeps verifying correctly even when the
 * ceremony is later served from a DIFFERENT hostname sharing the same
 * registrable domain (e.g. `o.nopal.build`) -- WebAuthn allows `rpID` to be
 * any registrable domain suffix of the origin, so `"nopal.build"` is valid
 * for both. Falls back to deriving from the request itself (today's
 * behavior, pre-pinning) when unset -- a safe default for any environment
 * (a fresh preview deploy, a contributor's fork, ...) that hasn't set it.
 *
 * IMPORTANT: this must be set correctly BEFORE a passkey ceremony is ever
 * served from a second hostname on the same registrable domain -- changing
 * `rpID` for a host that already has real registered passkeys breaks every
 * one of them (RP ID mismatch), with no user-facing explanation. See
 * docs/marketing-app-split-plan.md's "Critical risks" #1.
 */
function getRpID(request: Request): string {
  return process.env.WEBAUTHN_RP_ID || new URL(request.url).hostname;
}

/**
 * `@simplewebauthn/server` checks the ceremony's origin exactly, separately
 * from `rpID` above -- so once the app is reachable from more than one
 * origin sharing the same `rpID` (e.g. `https://nopal.build` AND
 * `https://o.nopal.build`), all of them need to be listed here explicitly.
 * `verifyRegistrationResponse`/`verifyAuthenticationResponse` both accept
 * either a single origin or an array, so this is additive -- comma-
 * separated via `WEBAUTHN_ALLOWED_ORIGINS`, falling back to the request's
 * own origin (today's single-origin behavior) when unset.
 */
function getExpectedOrigin(request: Request): string | string[] {
  const configured = process.env.WEBAUTHN_ALLOWED_ORIGINS;
  if (configured) {
    return configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Step 1 of registration: build the options for `navigator.credentials.create()`
 * (via @simplewebauthn/browser's `startRegistration`), and stash the
 * challenge + generated WebAuthn user handle in the session so we can verify
 * the response later.
 */
export async function generatePasskeyRegistrationOptions(
  request: Request,
  human: Human,
): Promise<{
  options: PublicKeyCredentialCreationOptionsJSON;
  setCookie: string;
}> {
  const existingPasskeys = await getPasskeysByHuman(human._id);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(request),
    userName: human.email,
    userDisplayName: human.name,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as any,
    })),
    // `residentKey: "required"` makes the credential discoverable, which is
    // what allows "usernameless" passkey login down the road.
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  session.set("passkeyChallenge", options.challenge);
  session.set("passkeyUserId", options.user.id);
  const setCookie = await sessionStorage.commitSession(session);

  return { options, setCookie };
}

/**
 * Step 2 of registration: verify the response from `startRegistration()` and
 * persist the new credential.
 */
export async function verifyPasskeyRegistration(
  request: Request,
  human: Human,
  response: RegistrationResponseJSON,
  name: string,
): Promise<{ verified: boolean; setCookie: string; error?: string }> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const expectedChallenge = session.get("passkeyChallenge");
  const webauthnUserId = session.get("passkeyUserId");

  if (!expectedChallenge || !webauthnUserId) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "Registration session expired. Please try again.",
    };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigin(request),
      expectedRPID: getRpID(request),
    });
  } catch (err) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: err instanceof Error ? err.message : "Verification failed.",
    };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "Could not verify passkey.",
    };
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  await createPasskey({
    humanId: human._id,
    webauthnUserId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    name: name.trim() || "Passkey",
  });

  session.unset("passkeyChallenge");
  session.unset("passkeyUserId");
  const setCookie = await sessionStorage.commitSession(session);

  return { verified: true, setCookie };
}

/**
 * Step 1 of passkey login: build options for `navigator.credentials.get()`
 * (via @simplewebauthn/browser's `startAuthentication`).
 *
 * With no `email`, this is a "usernameless" login: no `allowCredentials`
 * list is set, so the browser offers up any discoverable passkey registered
 * for this site. The resulting credential's `userHandle` is how we identify
 * the human afterwards.
 *
 * With an `email` (e.g. for a "switch account" flow, where the target
 * account is already known), `allowCredentials` is scoped to that human's
 * passkeys, so the browser/OS prompts for that specific account instead of
 * showing every passkey on the device.
 */
export async function generatePasskeyAuthenticationOptions(
  request: Request,
  email?: string,
): Promise<{
  options?: PublicKeyCredentialRequestOptionsJSON;
  setCookie: string;
  error?: string;
}> {
  let allowCredentials: { id: string; transports?: any }[] | undefined;

  if (email) {
    const human = await getHumanByEmail(email);
    const passkeysForHuman = human
      ? await getPasskeysByHuman(human._id)
      : [];

    if (!human || passkeysForHuman.length === 0) {
      const session = await sessionStorage.getSession(
        request.headers.get("cookie"),
      );
      return {
        setCookie: await sessionStorage.commitSession(session),
        error: "No passkey found for that email address.",
      };
    }

    allowCredentials = passkeysForHuman.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports as any,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpID(request),
    userVerification: "preferred",
    allowCredentials,
  });

  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  session.set("passkeyChallenge", options.challenge);
  const setCookie = await sessionStorage.commitSession(session);

  return { options, setCookie };
}

/**
 * Step 2 of passkey login: verify the response from `startAuthentication()`,
 * look up the human by the credential we stored at registration time, and
 * log them in by setting the `user` session key (mirroring what the TOTP
 * strategy does on success).
 */
export async function verifyPasskeyAuthentication(
  request: Request,
  response: AuthenticationResponseJSON,
): Promise<{
  verified: boolean;
  setCookie: string;
  error?: string;
  /** True when the identified human's account is suspended — callers
   * should route the visitor to /login-error rather than showing `error`
   * as an ordinary inline validation message. */
  suspended?: boolean;
}> {
  const session = await sessionStorage.getSession(
    request.headers.get("cookie"),
  );
  const expectedChallenge = session.get("passkeyChallenge");

  if (!expectedChallenge) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "Login session expired. Please try again.",
    };
  }

  const passkey = await getPasskeyByCredentialId(response.id);
  if (!passkey) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "We don't recognize that passkey.",
    };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigin(request),
      expectedRPID: getRpID(request),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
        counter: passkey.counter,
        transports: passkey.transports as any,
      },
    });
  } catch (err) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: err instanceof Error ? err.message : "Verification failed.",
    };
  }

  if (!verification.verified) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "Could not verify passkey.",
    };
  }

  const human = await getHumanById(passkey.humanId);
  if (!human) {
    return {
      verified: false,
      setCookie: await sessionStorage.commitSession(session),
      error: "No account found for that passkey.",
    };
  }
  if (human.suspendedAt) {
    return {
      verified: false,
      suspended: true,
      setCookie: await sessionStorage.commitSession(session),
      error: "This account has been suspended.",
    };
  }

  await updatePasskeyCounter(
    passkey._id,
    verification.authenticationInfo.newCounter,
  );

  session.unset("passkeyChallenge");
  // A fresh, independently-authenticated login always wins over any stale
  // impersonation state left on this browser's session cookie (see
  // startImpersonation/stopImpersonation in auth.server.ts).
  session.unset("impersonatorId");
  session.unset("impersonatorName");
  session.unset("impersonatorEmail");
  session.unset("impersonationExpiresAt");
  session.set("user", human);
  // Anchors the invalidation check in `getUser` — see the same call in
  // auth.server.ts's TOTP success callback.
  session.set("sessionIssuedAt", Date.now());
  const setCookie = await sessionStorage.commitSession(session);

  return { verified: true, setCookie };
}
