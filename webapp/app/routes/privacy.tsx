import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { Layout } from "../components/Layout";
import { FooterDiscovery } from "../components/Footer";
import { link } from "stamps/link.css";

export const meta: MetaFunction = () => [
  { title: "Privacy Notice | Nopal Build" },
  {
    name: "description",
    content: "What Nopal collects, why, and how it's stored and shared.",
  },
];

const LAST_UPDATED = "August 6, 2026";

export default function Privacy() {
  return (
    <Layout>
      <div className="scene1">
        <div
          className="simple-container p-4 mt-8 mb-16"
          style={{ maxWidth: 720 }}
        >
          <p className="text-sm uppercase tracking-widest mb-1 purple-light-text">
            Nopal Build
          </p>
          <h1 className="text-2xl font-bold purple-text">Privacy Notice</h1>
          <p className="mt-2 text-sm subtle-text">
            Last updated {LAST_UPDATED}
          </p>

          <p className="mt-6 text-base subtle-text" style={{ lineHeight: 1.7 }}>
            The short version: we collect the minimum we need to run Nopal,
            we tell you before we collect anything new, and we don't run any
            analytics, advertising, or tracking scripts on this site. If
            that ever changes, we'll ask first — not after.
          </p>

          <Section title="Who can even use Nopal">
            <p>
              Nopal is currently invite-only. Every account starts because
              someone at Nopal (or another Nopal user) invited that specific
              person by email — there's no public sign-up form. A few pages
              are the exception and are covered separately below: the{" "}
              <a href="/docs/wc-waiver" className={link}>
                workers' comp waiver
              </a>{" "}
              form and the{" "}
              <Link to="/contact" className={link}>
                newsletter
              </Link>{" "}
              sign-up, both of which don't require an account.
            </p>
          </Section>

          <Section title="What we collect, and why">
            <SubSection title="Account & login">
              <p>
                Name and email address (whatever your inviter entered, and
                whatever you update it to). If you set up a passkey, your
                device stores your private key — we only ever see the public
                key, which can't be used to sign in as you without your
                device.
              </p>
            </SubSection>
            <SubSection title="Session cookie">
              <p>
                A single cookie (<code>_auth</code>) that keeps you signed
                in. It's first-party, marked <code>httpOnly</code> so
                JavaScript can't read it, and only used to know who you are —
                never for tracking or advertising. This is the only cookie
                Nopal sets, and it's why you won't see a cookie banner here:
                it's strictly necessary for the site to work, not optional
                tracking.
              </p>
            </SubSection>
            <SubSection title="Files you upload (Vault & Daily Log)">
              <p>
                Photos, PDFs, and documents you upload are stored privately —
                only you (and anyone you've explicitly shared a folder with)
                can access them. Every request for a file's contents is
                checked against who's signed in; files are never made public
                by default.
              </p>
            </SubSection>
            <SubSection title="Keeping Nopal available (rate limiting)">
              <p>
                Like most web apps, our servers briefly note the IP address
                of incoming requests so we can detect and throttle unusually
                high traffic from any one source — this protects Nopal from
                being knocked over (or running up a surprise bill) by a
                traffic spike or an automated script. This only lives in
                server memory for a few minutes to enforce those limits; it
                isn't written to our database, linked to your account, sold,
                or used for tracking or advertising. (The Workers' Comp
                Waiver form below is the one exception, where an IP is kept
                as part of a permanent legal record.)
              </p>
            </SubSection>
            <SubSection title="Workers' Comp Waiver form">
              <p>
                If you sign the Arizona Independent Contractor Workers'
                Compensation Acknowledgment, we record what's on the form
                (name, business/license/insurance details, contact info,
                signature) plus your IP address and the time of signing, to
                keep a legal record of that acknowledgment. A copy is emailed
                to you and to Nopal staff; it's otherwise only accessible to
                staff and to you, if you view it from a Nopal account under
                that email address.
              </p>
            </SubSection>
            <SubSection title="Newsletter">
              <p>
                Only if you check the opt-in box on the{" "}
                <Link to="/contact" className={link}>
                  contact page
                </Link>
                : your name and email, sent to our email provider (Resend) to
                deliver the newsletter. You can unsubscribe any time from the
                link in any email we send.
              </p>
            </SubSection>
          </Section>

          <Section title="What we don't do">
            <p>
              No analytics, no advertising pixels, no third-party trackers of
              any kind — we checked, and there simply aren't any on this
              site. Videos embedded in our content use YouTube's and Vimeo's
              privacy-enhanced modes, which don't set tracking cookies unless
              you press play.
            </p>
          </Section>

          <Section title="Who we share data with">
            <p>
              We use a small number of infrastructure providers to run
              Nopal, all acting only on our instructions:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Resend</strong> — sends the emails Nopal sends you
                (login codes, invites, notifications) and, if you opt in,
                the newsletter.
              </li>
              <li>
                <strong>Fly.io / Tigris</strong> — hosts the app and stores
                uploaded files (Vault, Daily Log, signed documents).
              </li>
              <li>
                <strong>Notion</strong> — powers some of our public building
                content (materials, guides). It doesn't receive any of your
                personal data.
              </li>
            </ul>
            <p>
              We don't sell data, and we don't share it with anyone else for
              marketing or advertising purposes.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              Account data and files are kept while your account exists.
              Signed legal documents (like the WC waiver) are kept as long
              as required for legal/compliance record-keeping. Newsletter
              contacts are kept until you unsubscribe. If you'd like
              something deleted sooner, just ask — see below.
            </p>
          </Section>

          <Section title="Your rights">
            <p>
              You can ask us what we have on you, ask us to correct it, or
              ask us to delete it, at any time. Because Nopal is small and
              invite-only today, we handle these requests directly — email{" "}
              <a href="mailto:human@nopal.build" className={link}>
                human@nopal.build
              </a>{" "}
              and we'll sort it out. If you're in the EU/UK, this includes
              your rights under GDPR (access, rectification, erasure,
              portability, and objection); if you're a California resident,
              this includes your rights under the CCPA.
            </p>
          </Section>

          <Section title="Changes to this notice">
            <p>
              If what we collect or how we use it changes meaningfully,
              we'll update this page and, where it affects something you've
              already agreed to, ask you again before continuing.
            </p>
          </Section>

          <Section title="Questions">
            <p>
              Email{" "}
              <a href="mailto:human@nopal.build" className={link}>
                human@nopal.build
              </a>{" "}
              — a human will answer.
            </p>
          </Section>
        </div>
      </div>
      <FooterDiscovery />
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
    <div className="mt-10">
      <h2
        className="text-lg font-semibold mb-3 pb-2 purple-text"
        style={{ borderBottom: "1px solid var(--foreground)" }}
      >
        {title}
      </h2>
      <div className="space-y-3 text-base subtle-text" style={{ lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="font-semibold purple-light-text mb-1">{title}</h3>
      {children}
    </div>
  );
}
