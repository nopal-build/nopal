import { render } from "@react-email/render";
import { ReactNode, ReactElement } from "react";
import { createTransport } from "nodemailer";
import { Resend } from "resend";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

export type SendEmailBody = {
  to: string[];
  subject: string;
  react: ReactNode;
  attachments?: EmailAttachment[];
};

const isDev = process.env.NODE_ENV === "development";

const resend =
  !isDev && process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : undefined;

const smtpTransport = isDev
  ? createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
      auth: undefined,
    })
  : undefined;

export async function sendEmail({
  to,
  subject,
  react,
  attachments,
}: SendEmailBody) {
  if (smtpTransport) {
    console.log("[email] Sending via SMTP (Mailpit)...", {
      host: process.env.SMTP_HOST ?? "localhost",
      port: process.env.SMTP_PORT ?? 1025,
      to,
      subject,
    });
    const html = await render(react as ReactElement);
    const result = await smtpTransport.sendMail({
      from: "Nopal Rowbot <rowbot@nopal.build>",
      to: to.join(", "),
      subject,
      html,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });
    console.log("[email] Sent via SMTP (Mailpit).", {
      messageId: result.messageId,
      accepted: result.accepted,
      rejected: result.rejected,
      to,
      subject,
    });
    return result;
  }

  if (resend) {
    console.log("[email] Sending via Resend...", { to, subject });
    const result = await resend.emails.send({
      from: "Nopal Rowbot <rowbot@nopal.build>",
      to,
      subject,
      react,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        // Resend accepts Buffer directly
        content: a.content,
      })),
    });
    if (result.error) {
      console.error("[email] Resend error:", result.error);
    } else {
      console.log("[email] Sent via Resend.", {
        id: result.data?.id,
        to,
        subject,
      });
    }
    return result;
  }

  console.log("[email] No RESEND_API_KEY or SMTP config, email not sent.", {
    to,
    subject,
  });
}

type NewsletterSubscription = {
  email: string;
  firstName: string;
  lastName: string;
};

export async function subscribeToNewsletter({
  email,
  firstName,
  lastName,
}: NewsletterSubscription) {
  if (!resend) {
    console.log("No RESEND_API_KEY, user not subscribed.", {
      email,
      firstName,
      lastName,
    });
    return;
  }

  const result = await resend.contacts.create({ email, firstName, lastName });
  if (result.error) {
    // Resend's contacts API returns { data: null, error } rather than
    // throwing — surface it as a real error so the caller's try/catch
    // (and therefore the user-facing form) actually sees the failure
    // instead of silently treating it as a successful subscription.
    throw new Error(result.error.message ?? "Failed to subscribe to newsletter");
  }
}
