import { useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import { generateWaiverPdf } from "../util/waiverPdf.server";
import { uploadPrivateFileToS3, getPresignedViewUrl } from "robustness-core/data/file.server";
import { createLegalDocument } from "robustness-core/data/legalDocuments.server";
import { sendEmail } from "../util/email.server";
import { WaiverComplete } from "../emails/waiverComplete";

// Fallback for contexts with no `Request` available. Any call site with
// access to the incoming request should pass it in so the link points at
// the actual host (localhost in dev, nopal.build in prod).
const FALLBACK_APP_BASE_URL = "https://nopal.build";
function getAppBaseUrl(request?: Request): string {
  if (request) {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
  }
  return FALLBACK_APP_BASE_URL;
}

export const meta: MetaFunction = () => [
  {
    title:
      "Arizona Independent Contractor Workers' Compensation Acknowledgment | Nopal Build",
  },
  {
    name: "description",
    content:
      "Arizona Independent Contractor Workers' Compensation Acknowledgment and Responsibility form.",
  },
  // Prevent indexing — this is an internal legal document form
  { name: "robots", content: "noindex, nofollow" },
];

const CONTRACTOR_NAME = "Nopal LLC";

// ── Action ───────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();

  const get = (key: string) => (form.get(key) as string | null)?.trim() ?? "";

  // Parse fields
  const contractorName = CONTRACTOR_NAME;
  const icName = get("ic_name");
  const businessName = get("business_name");
  const rocLicense = get("roc_license");
  const phone = get("phone");
  const email = get("email");
  const hasWcInsurance = form.get("has_wc_insurance") === "yes";
  const insuranceCarrier = get("insurance_carrier");
  const policyNumber = get("policy_number");
  const expirationDate = get("expiration_date");
  const signatureName = get("signature_name");
  const esigConsent = form.get("esig_consent") === "on";

  // Server-side validation
  const errors: Record<string, string> = {};
  const tooLong = (val: string, max: number) => val.length > max;
  if (!icName) errors.ic_name = "Required";
  else if (tooLong(icName, 120))
    errors.ic_name = "Too long (max 120 characters)";
  if (tooLong(businessName, 120))
    errors.business_name = "Too long (max 120 characters)";
  if (tooLong(rocLicense, 40))
    errors.roc_license = "Too long (max 40 characters)";
  if (tooLong(phone, 30)) errors.phone = "Too long (max 30 characters)";
  if (tooLong(insuranceCarrier, 120))
    errors.insurance_carrier = "Too long (max 120 characters)";
  if (tooLong(policyNumber, 60))
    errors.policy_number = "Too long (max 60 characters)";
  if (tooLong(signatureName, 120))
    errors.signature_name = "Too long (max 120 characters)";
  if (!email) errors.email = "Required";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = "Enter a valid email address";
  if (!signatureName) errors.signature_name = "Required";
  if (!esigConsent)
    errors.esig_consent =
      "You must consent to sign this document electronically";
  if (hasWcInsurance) {
    if (!insuranceCarrier) errors.insurance_carrier = "Required";
    if (!policyNumber) errors.policy_number = "Required";
    if (!expirationDate) errors.expiration_date = "Required";
  }

  if (Object.keys(errors).length > 0) {
    return Response.json({ ok: false, errors }, { status: 422 });
  }

  // Capture audit info
  const signedAt = new Date().toISOString();
  const ipAddress =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";

  try {
    // 1. Generate PDF
    const pdfBuffer = await generateWaiverPdf({
      contractorName,
      icName,
      businessName,
      rocLicense,
      phone,
      email,
      hasWcInsurance,
      insuranceCarrier,
      policyNumber,
      expirationDate,
      signatureName,
      signedAt,
      ipAddress,
    });

    // 2. Upload to S3 — private (no public ACL). The only ways to view it
    // afterwards are: the PDF attached to the emails below, the one-time
    // signed link in this response, and (for the signer's own account or
    // staff) /api/legal-documents/view/:docId.
    const sanitizedName = icName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const s3Key = `legal-docs/wc-waiver/${Date.now()}-${sanitizedName}.pdf`;
    const s3Url = await uploadPrivateFileToS3(pdfBuffer, s3Key);

    // 3. Save to database
    const doc = await createLegalDocument({
      document_type: "wc_waiver",
      contractor_name: contractorName,
      ic_name: icName,
      business_name: businessName,
      roc_license: rocLicense,
      phone,
      email,
      has_wc_insurance: hasWcInsurance,
      insurance_carrier: insuranceCarrier,
      policy_number: policyNumber,
      expiration_date: expirationDate,
      signature_name: signatureName,
      signed_at: signedAt,
      ip_address: ipAddress,
      s3_url: s3Url,
      s3_key: s3Key,
    });

    const pdfAttachment = {
      filename: `wc-waiver-${sanitizedName}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf" as const,
    };

    // Staff have Nopal accounts, so the admin email can safely link to the
    // ownership-checked view route. The signer may not have an account at
    // all, so their email relies solely on the attachment — no link that
    // could either 404 or (worse) need to be made guessable/public again.
    const adminPdfUrl = doc
      ? `${getAppBaseUrl(request)}/api/legal-documents/view/${doc._id}`
      : undefined;

    // 4. Send emails (fire-and-forget errors so we don't fail the response)
    await Promise.allSettled([
      // Admin notification
      sendEmail({
        to: ["human@nopal.build"],
        subject: `WC Waiver Signed — ${icName}`,
        react: WaiverComplete({
          icName,
          contractorName,
          signedAt,
          pdfUrl: adminPdfUrl,
          recipientType: "admin",
        }),
        attachments: [pdfAttachment],
      }),
      // Contractor copy — no pdfUrl; see note above.
      sendEmail({
        to: [email],
        subject: "Your Signed Workers' Comp Waiver — Nopal Build",
        react: WaiverComplete({
          icName,
          contractorName,
          signedAt,
          recipientType: "contractor",
        }),
        attachments: [pdfAttachment],
      }),
    ]);

    // One-time, short-lived signed URL so the person who just submitted the
    // form (who may have no account) can immediately view/download their
    // own PDF from the success screen, without making the file permanently
    // public.
    const successPdfUrl = await getPresignedViewUrl(s3Key);

    return Response.json({ ok: true, pdfUrl: successPdfUrl });
  } catch (err) {
    console.error("[wc-waiver] submission error:", err);
    return Response.json(
      {
        ok: false,
        errors: {
          _global:
            "Something went wrong processing your submission. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

type ActionResult =
  | { ok: true; pdfUrl: string }
  | { ok: false; errors: Record<string, string> };

export default function WcWaiver() {
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const defaultName = searchParams.get("name") ?? "";
  const defaultEmail = searchParams.get("email") ?? "";

  const [hasWcInsurance, setHasWcInsurance] = useState<boolean | null>(null);

  const errors = actionData && !actionData.ok ? actionData.errors : undefined;

  if (actionData?.ok) {
    return (
      <Layout>
        <div className="scene1">
          <div
            className="simple-container p-4 mt-12 mb-16"
            style={{ maxWidth: 640 }}
          >
            <SuccessScreen pdfUrl={actionData.pdfUrl} />
          </div>
        </div>
        <Footer />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="scene1">
        <div
          className="simple-container p-4 mt-8 mb-16"
          style={{ maxWidth: 640 }}
        >
          {/* Header */}
          <div className="mb-6">
            <p className="text-sm uppercase tracking-widest mb-1 purple-light-text">
              Arizona Independent Contractor
            </p>
            <h1 className="text-2xl font-bold purple-text">
              Workers' Compensation Acknowledgment
            </h1>
            <p className="mt-2 text-sm subtle-text">
              Please read and complete all sections below, then sign at the
              bottom. A copy of the signed document will be emailed to you.
            </p>
          </div>

          {errors?._global && (
            <div
              className="mb-4 p-3 rounded text-sm"
              style={{
                background: "var(--red-light)",
                color: "var(--red)",
                border: "1px solid var(--red)",
              }}
            >
              {errors._global}
            </div>
          )}

          <Form method="post" className="space-y-8">
            {/* ── Section 1: Party Info ─────────────────────────────── */}
            <Section title="Party Information">
              <div>
                <p className="block text-sm font-medium mb-1 purple-text">
                  Contractor
                </p>
                <p
                  className="w-full rounded px-3 py-2 text-sm"
                  style={{
                    border: "1px solid var(--foreground)",
                    background: "var(--midground)",
                    color: "var(--text-subtle)",
                  }}
                >
                  {CONTRACTOR_NAME}
                </p>
                <input
                  type="hidden"
                  name="contractor_name"
                  value={CONTRACTOR_NAME}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Independent Contractor Name"
                  name="ic_name"
                  placeholder="Your full legal name"
                  defaultValue={defaultName}
                  required
                  error={errors?.ic_name}
                />
                <Field
                  label="Business Name (if applicable)"
                  name="business_name"
                  placeholder="DBA or LLC name"
                  error={errors?.business_name}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="ROC License No. (if applicable)"
                  name="roc_license"
                  placeholder="ROC-XXXXXXX"
                  error={errors?.roc_license}
                />
                <Field
                  label="Phone"
                  name="phone"
                  type="tel"
                  placeholder="(555) 555-5555"
                  error={errors?.phone}
                />
              </div>
              <Field
                label="Email"
                name="email"
                type="email"
                placeholder="you@example.com"
                defaultValue={defaultEmail}
                required
                error={errors?.email}
              />
            </Section>

            {/* ── Section 2: Acknowledgment Checkboxes ─────────────── */}
            <Section title="Independent Contractor Acknowledgment">
              <p className="text-sm mb-4 subtle-text">
                I certify that I am performing work as an independent contractor
                and not as an employee of the Contractor identified above. I
                understand and acknowledge the following:
              </p>
              <div className="space-y-3">
                <AckCheckbox
                  name="ack_1"
                  text="I am responsible for determining whether Arizona law requires me or my business to maintain workers' compensation insurance."
                />
                <AckCheckbox
                  name="ack_2"
                  text="I am solely responsible for obtaining and maintaining any workers' compensation insurance required by law for myself and any employees I hire."
                />
                <AckCheckbox
                  name="ack_3"
                  text="If I hire or supervise any employees, laborers, or subcontractors, I am solely responsible for complying with all applicable federal, state, and local employment and insurance laws."
                />
                <AckCheckbox
                  name="ack_4"
                  text="I understand that the Contractor is relying upon my representation that I am an independent contractor."
                />
                <AckCheckbox
                  name="ack_5"
                  text="I agree to indemnify and hold harmless the Contractor, Owner, and their agents from any claims, penalties, assessments, or costs arising from my failure to obtain any workers' compensation coverage required by law."
                />
                <AckCheckbox
                  name="ack_6"
                  text="I understand that nothing contained in this document creates an employer-employee relationship."
                />
              </div>
            </Section>

            {/* ── Section 3: WC Coverage ────────────────────────────── */}
            <Section title="Workers' Compensation Coverage">
              <p className="text-sm mb-4 subtle-text">
                Please select one:
              </p>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="has_wc_insurance"
                    value="yes"
                    onChange={() => setHasWcInsurance(true)}
                    className="mt-1 shrink-0"
                    style={{ accentColor: "var(--green)" }}
                    required
                  />
                  <span className="text-sm purple-text">
                    I maintain workers' compensation insurance.
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="has_wc_insurance"
                    value="no"
                    onChange={() => setHasWcInsurance(false)}
                    className="mt-1 shrink-0"
                    style={{ accentColor: "var(--green)" }}
                  />
                  <span className="text-sm purple-text">
                    I do not maintain workers' compensation insurance because I
                    believe it is not required for my business under Arizona
                    law.
                  </span>
                </label>
              </div>

              {hasWcInsurance && (
                <div
                  className="mt-4 space-y-4 pl-6 border-l-2"
                  style={{ borderColor: "var(--green)" }}
                >
                  <Field
                    label="Insurance Carrier"
                    name="insurance_carrier"
                    placeholder="e.g. State Farm"
                    required
                    error={errors?.insurance_carrier}
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      label="Policy Number"
                      name="policy_number"
                      placeholder="Policy number"
                      required
                      error={errors?.policy_number}
                    />
                    <Field
                      label="Expiration Date"
                      name="expiration_date"
                      type="date"
                      required
                      error={errors?.expiration_date}
                    />
                  </div>
                </div>
              )}
            </Section>

            {/* ── Section 4: Certification & Signature ─────────────── */}
            <Section title="Certification & Electronic Signature">
              <p className="text-sm mb-4 subtle-text">
                I certify that the information provided above is true and
                correct. I understand that providing false information may
                result in termination of my contract and may subject me to
                liability under applicable law.
              </p>

              <Field
                label="Type your full legal name as your signature"
                name="signature_name"
                placeholder="Full legal name"
                required
                error={errors?.signature_name}
              />

              <div className="mt-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="esig_consent"
                    className="mt-1 shrink-0"
                    style={{ accentColor: "var(--green)" }}
                  />
                  <span className="text-sm purple-text">
                    By typing my name above and checking this box, I agree that
                    my typed name constitutes my legally binding electronic
                    signature on this document, and I consent to conducting this
                    transaction electronically in accordance with the ESIGN Act
                    and UETA.
                  </span>
                </label>
                {errors?.esig_consent && (
                  <p className="mt-1 text-xs" style={{ color: "var(--red)" }}>
                    {errors.esig_consent}
                  </p>
                )}
              </div>

              <p className="mt-4 text-xs subtle-text">
                <strong>Privacy notice:</strong> the information above (your
                name, business/license/insurance details, contact info, and
                signature), along with your IP address and the date/time of
                signing, is recorded to create and keep a legal record of
                this acknowledgment, as required for Arizona
                independent-contractor compliance. A copy of the signed PDF
                is emailed to you and to Nopal staff. It's otherwise only
                accessible to Nopal staff and to you, if you view it from a
                Nopal account under this email address — it is never made
                public. See our{" "}
                <Link to="/privacy" className="link" target="_blank">
                  privacy notice
                </Link>{" "}
                for more, or contact{" "}
                <a href="mailto:human@nopal.build" className="link">
                  human@nopal.build
                </a>
                .
              </p>
            </Section>

            {/* ── Submit ────────────────────────────────────────────── */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-primary"
                style={
                  isSubmitting ? { opacity: 0.6, cursor: "not-allowed" } : {}
                }
              >
                {isSubmitting ? "Processing…" : "Sign & Submit Waiver"}
              </button>
            </div>
          </Form>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2
        className="text-base font-semibold mb-4 pb-2 purple-text"
        style={{
          borderBottom: "1px solid var(--foreground)",
        }}
      >
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

const FIELD_MAX_LENGTHS: Record<string, number> = {
  ic_name: 120,
  business_name: 120,
  roc_license: 40,
  phone: 30,
  email: 254,
  insurance_carrier: 120,
  policy_number: 60,
  expiration_date: 10,
  signature_name: 120,
};

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  required,
  error,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium mb-1 purple-text"
      >
        {label}
        {required && (
          <span className="ml-1" style={{ color: "var(--red)" }}>
            *
          </span>
        )}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded px-3 py-2 text-sm"
        maxLength={FIELD_MAX_LENGTHS[name]}
        style={{
          border: error
            ? "1px solid var(--red)"
            : "1px solid var(--foreground)",
          background: "var(--farground)",
          color: "var(--purple)",
          outline: "none",
        }}
      />
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function AckCheckbox({ name, text }: { name: string; text: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        name={name}
        className="mt-0.5 shrink-0"
        style={{ accentColor: "var(--green)" }}
      />
      <span className="text-sm purple-text">
        {text}
      </span>
    </label>
  );
}

function SuccessScreen({ pdfUrl }: { pdfUrl: string }) {
  return (
    <div className="text-center py-8">
      {/* Checkmark icon */}
      <div
        className="mx-auto mb-6 flex items-center justify-center rounded-full"
        style={{
          width: 64,
          height: 64,
          background: "var(--green)",
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold mb-2 purple-text">
        Waiver Signed Successfully
      </h1>
      <p
        className="mb-6 text-sm subtle-text"
        style={{
          maxWidth: 420,
          margin: "0 auto 24px",
        }}
      >
        Your signed Workers' Compensation Acknowledgment has been recorded. A
        copy has been emailed to you and to <strong>human@nopal.build</strong>.
      </p>

      <a
        href={pdfUrl}
        download
        target="_blank"
        rel="noopener noreferrer"
        className="btn-secondary inline-flex items-center gap-2"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download Signed PDF
      </a>

      <p className="mt-6 text-xs subtle-text">
        This document was electronically signed in accordance with the ESIGN Act
        and UETA.
      </p>
    </div>
  );
}
