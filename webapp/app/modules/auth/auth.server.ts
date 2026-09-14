// TEMPORARY re-export shim -- see session.server.ts's comment in this same
// directory. Delete this whole directory once login moves to o.nopal.build
// (Phase 3+ of docs/marketing-app-split-plan.md).
//
// One real piece of wiring lives here, not in robustness-core: how a login
// code's email actually gets rendered + sent. That's deliberately kept out
// of the shared package (no React/email-provider deps there), so whichever
// app owns the login flow must call `configureAuth` itself, once, before
// any real login attempt -- today that's webapp; this whole block moves to
// the app service's own auth setup once login does.
import { configureAuth } from "robustness-core/auth/auth.server";
import { sendEmail } from "../../util/email.server";
import { LoginCode } from "../../emails/loginCode";

configureAuth({
  sendTotpEmail: async ({ email, code, magicLink }) => {
    await sendEmail({
      to: [email],
      subject: "Nopal Login Code",
      react: LoginCode({ code, magicLink }),
    });
  },
});

export * from "robustness-core/auth/auth.server";
