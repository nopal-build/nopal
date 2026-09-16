// app/routes/login-error.tsx
//
// Landing spot for a login attempt that can't succeed for a reason the
// visitor can't fix themselves — currently just a suspended account (see
// `suspendHuman`/`getUser` in auth.server.ts and the TOTP/passkey login
// checks that redirect here). Deliberately generic/static rather than
// naming the specific reason, so it doesn't confirm to an outside party
// whether a given email is a real, suspended account.
import { Link } from "react-router";
import { surfaceBase } from "stamps/surface.css";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { link } from "stamps/link.css";
import { AuthShell } from "../components/AuthShell";

export default function LoginError() {
  return (
    <AuthShell title="Login Problem">
      <div className={`${surfaceBase} ${textSize.lg} ${sprinkles({ p: 4 })}`}>
        <p>
          There has been a problem logging in as this user. Please
          contact{" "}
          <a href="mailto:human@nopal.build" className={link}>
            human@nopal.build
          </a>{" "}
          for help.
        </p>
      </div>
      <div className={sprinkles({ mt: 8 })}>
        <Link to="/login" className={link}>
          ← Back to login
        </Link>
      </div>
    </AuthShell>
  );
}
