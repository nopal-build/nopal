// Re-export shim -- see session.server.ts's comment in this same
// directory. One real piece of wiring lives here, not in robustness-core:
// how a login code's email actually gets rendered + sent (`configureAuth`
// below) -- kept app-local since it needs React email rendering + a mail
// provider, neither of which robustness-core otherwise depends on.
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
