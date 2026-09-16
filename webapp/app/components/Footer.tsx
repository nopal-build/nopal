import { Link, NavLink, useRouteLoaderData } from "react-router";
import { ReactNode } from "react";
import type { RootLoaderData } from "../root";

// The app (login, dashboard, everything else that used to live at
// /fruits/*) is a separate service now -- see
// docs/marketing-app-split-plan.md. Read from the root loader's
// `appBaseUrl` (ultimately process.env.APP_BASE_URL) rather than
// hardcoding it here -- this used to be a NODE_ENV-based guess
// (prod/dev only, no staging case), which meant the "Login" link on
// nopal-webapp-staging silently pointed at REAL prod (o.nopal.build)
// instead of fruits-staging.fly.dev, since the Docker image's own
// NODE_ENV is hardcoded to "production" for every deploy target, staging
// included (see webapp/Dockerfile). `process.env.APP_BASE_URL` itself
// isn't safe to reference directly in a component rendered on the
// client too (Vite only inlines a small allowlist like NODE_ENV into the
// client bundle, not arbitrary env vars) -- the root loader is what
// actually resolves it per-request, server-side, and ships it down as
// ordinary loader data instead.
function useAppUrl(): string {
  const rootData = useRouteLoaderData<RootLoaderData>("root");
  return rootData?.appBaseUrl ?? "https://o.nopal.build";
}

function ContactUsLinks() {
  return (
    <div className="flex gap-4 items-center">
      <a
        href="https://discord.gg/avFGzMNAXu"
        target="_blank"
        className="btn-secondary"
      >
        Join our Discord
      </a>
      <a href="mailto:human@nopal.build" className="p-4 pt-2 pb-2">
        Email us
      </a>
    </div>
  );
}

export function FooterBase({ children }: { children?: ReactNode }) {
  const appUrl = useAppUrl();
  return (
    <div className="scene0">
      <div className="scene0-bg" />
      <div className="scene0-shadow-bg" />
      <div className="scene0-pricklyPearFruit" />
      <div className="flex justify-end">
        {children && (
          <div className="scene0-content p-10 lg:p-20">{children}</div>
        )}
      </div>
      <div className="footer p-8 pt-4 pb-4">
        <div className="flex gap-2">
          <NavLink
            prefetch="render"
            className="hover:underline text-nowrap"
            to="/about"
          >
            Who We Are
          </NavLink>
          <NavLink
            prefetch="render"
            className="ml-4 hover:underline text-nowrap"
            to="/path"
          >
            Path
          </NavLink>
          <NavLink
            prefetch="render"
            className="ml-4 hover:underline text-nowrap"
            to="/tools"
          >
            Tools
          </NavLink>
          <a
            className="ml-4 hover:underline text-nowrap"
            href={`${appUrl}/login`}
          >
            Login
          </a>
          <NavLink
            prefetch="render"
            className="ml-4 hover:underline text-nowrap"
            to="/contact"
          >
            Contact
          </NavLink>
          <NavLink
            prefetch="render"
            className="ml-4 hover:underline text-nowrap"
            to="/privacy"
          >
            Privacy
          </NavLink>
        </div>
        <div className="inline-flex mt-4 gap-2 items-center">
          {padSvg}
          {padSvg}
          {padSvg}
        </div>
      </div>
    </div>
  );
}

export function Footer({
  title,
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <FooterBase>
      {title ? (
        <>
          <h2 className="text-2xl">{title}</h2>
          <p className="text-base max-w-96 mt-4 mb-4 text-right">{children}</p>
          <ContactUsLinks />
        </>
      ) : null}
    </FooterBase>
  );
}

export function FooterDiscovery({
  label,
  to,
  children,
}: {
  label?: string;
  to?: string;
  children?: ReactNode;
}) {
  return (
    <FooterBase>
      {label && to && children && (
        <div className="discover-text red-text font-hand">
          <span>{label}</span>
          <Link to={to}>{children}</Link>
        </div>
      )}
    </FooterBase>
  );
}

const padSvg = (
  <svg
    width="28"
    height="16"
    viewBox="0 0 28 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M14.0632 15.7061C4.93032 15.2218 0.767884 12.1794 0.606669 10.0551C0.431272 7.74391 5.54053 3.38425 13.2558 1.29516C20.0253 -0.537834 26.0088 3.33456 27.7082 8.75014C29.4077 14.1657 21.0908 16.0788 14.0632 15.7061Z"
      fill="white"
    />
  </svg>
);
