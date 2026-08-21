import { Layout } from "../components/Layout";
import { FooterDiscovery } from "../components/Footer";
import { surfaceBase, surfaceHoverable } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { subscribeToNewsletter } from "../util/email.server";
import { useUserPrefs } from "../hooks/useUserPrefs";

type ActionResult =
  | { success: true }
  | { success: false; error: string };

export async function action({
  request,
}: ActionFunctionArgs): Promise<ActionResult> {
  const formData = await request.formData();
  const email = ((formData.get("email") as string) ?? "").trim();
  const firstName = ((formData.get("firstName") as string) ?? "").trim();
  const lastName = ((formData.get("lastName") as string) ?? "").trim();
  const consent = formData.get("newsletter_consent") === "on";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Enter a valid email address." };
  }
  // Only subscribe on an explicit opt-in — we never sign anyone up for
  // marketing email without them having checked this box themselves.
  if (!consent) {
    return {
      success: false,
      error: "Please check the box to confirm you'd like to receive emails.",
    };
  }

  try {
    await subscribeToNewsletter({ email, firstName, lastName });
  } catch (err) {
    console.error("[contact] newsletter subscribe failed:", err);
    return {
      success: false,
      error: "Something went wrong subscribing you. Please try again.",
    };
  }

  return { success: true };
}

export default function Contact() {
  const [userPrefs, setUserPrefs] = useUserPrefs();
  const [success, setSuccess] = useState(false);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      setSuccess(true);
      setUserPrefs({ ...userPrefs, newsletter: true });
    }
  }, [actionData]);

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4 mt-16">
          <h1 className="purple-light-text text-4xl">Contact</h1>

          <div className="flex gap-8 flex-col sm:flex-row items-start sm:items-center text-xl mt-8">
            <ButtonLink href="https://calendly.com/build-for-good/30min">
              Schedule a Call
            </ButtonLink>
            <ButtonLink href="https://discord.gg/avFGzMNAXu">
              Join us on Discord
            </ButtonLink>
          </div>
          <div className="mt-4">
            <a href="mailto:human@nopal.build" className={link}>
              Email us at human@nopal.build
            </a>
          </div>
          <div className="mt-12">
            <Form method="post">
              <h1 className="text-2xl purple-light-text">Nopal Newsletter</h1>
              <div className="mt-4">
                <input
                  className="border border-gray-300 rounded px-2 py-1 mr-4"
                  type="text"
                  name="firstName"
                  placeholder="First Name"
                />
                <input
                  className="border border-gray-300 rounded px-2 py-1"
                  type="text"
                  name="lastName"
                  placeholder="Last Name"
                />
              </div>
              <div className="mt-4">
                <input
                  type="email"
                  name="email"
                  placeholder="Email"
                  required
                  className="border border-gray-300 rounded px-2 py-1"
                />
              </div>
              {!(success || userPrefs.newsletter) && (
                <div className="mt-4">
                  <label className="flex items-start gap-2 text-sm subtle-text cursor-pointer">
                    <input
                      type="checkbox"
                      name="newsletter_consent"
                      required
                      className="mt-1 shrink-0"
                    />
                    <span>
                      Yes, email me occasional updates from Nopal. See our{" "}
                      <Link to="/privacy" className={link} target="_blank">
                        privacy notice
                      </Link>{" "}
                      for how we use it — you can unsubscribe any time from
                      the link in any email we send.
                    </span>
                  </label>
                </div>
              )}
              <div className="mt-4 flex items-center">
                {!(success || userPrefs.newsletter) && (
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="btn-secondary"
                    style={
                      isSubmitting ? { opacity: 0.6, cursor: "not-allowed" } : {}
                    }
                  >
                    {isSubmitting ? "Subscribing…" : "Subscribe"}
                  </button>
                )}
                {success || userPrefs.newsletter ? (
                  <p className="self-center green-light-text italic">
                    You subscribed to the newsletter {"👍"}
                  </p>
                ) : (
                  actionData?.success === false && (
                    <p className="ml-4 self-center text-sm" style={{ color: "var(--red)" }}>
                      {actionData.error}
                    </p>
                  )
                )}
              </div>
            </Form>
          </div>
          <h2 className="purple-light-text text-2xl mt-16">Social Medias</h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mt-4">
            <ButtonLink href="https://www.instagram.com/nopal.build/">
              <InstagramLogo /> @nopal.build on Instagram
            </ButtonLink>
            <ButtonLink href="https://www.youtube.com/@nopal-build">
              <YouTubeLogo /> YouTube Channel
            </ButtonLink>
          </div>
        </div>
      </div>
      <FooterDiscovery />
    </Layout>
  );
}

function ButtonLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      className={`text-nowrap ${surfaceBase} ${surfaceHoverable} justify-between inline-flex items-center gap-4 p-2`}
      target="_blank"
      href={href}
    >
      <span className="inline-flex items-center gap-2">{children}</span>
    </a>
  );
}

const InstagramLogo = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20 2H8C4.68629 2 2 4.68629 2 8V20C2 23.3137 4.68629 26 8 26H20C23.3137 26 26 23.3137 26 20V8C26 4.68629 23.3137 2 20 2Z"
      stroke="#5DA06D"
      strokeWidth="2.455"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 18.5005C16.4853 18.5005 18.5 16.4858 18.5 14.0005C18.5 11.5152 16.4853 9.50049 14 9.50049C11.5147 9.50049 9.5 11.5152 9.5 14.0005C9.5 16.4858 11.5147 18.5005 14 18.5005Z"
      stroke="#5DA06D"
      strokeWidth="2.455"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M20.75 7.25V7.251"
      stroke="#5DA06D"
      strokeWidth="2.455"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const YouTubeLogo = () => (
  <svg
    width="28"
    height="22"
    viewBox="0 0 28 22"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M20.6667 2H7.33333C4.38781 2 2 4.38781 2 7.33333V15.3333C2 18.2789 4.38781 20.6667 7.33333 20.6667H20.6667C23.6122 20.6667 26 18.2789 26 15.3333V7.33333C26 4.38781 23.6122 2 20.6667 2Z"
      stroke="#5DA06D"
      strokeWidth="2.455"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.333 7.33374L17.9997 11.3337L11.333 15.3337V7.33374Z"
      stroke="#5DA06D"
      strokeWidth="2.455"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
