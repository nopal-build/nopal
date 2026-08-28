import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
  isRouteErrorResponse,
  useNavigation,
} from "react-router";
import {
  MetaFunction,
  LinksFunction,
  type LoaderFunctionArgs,
} from "react-router";
import styles from "./styles/root.css?url";
import faviconAppleTouch from "./images/favicon/apple-touch-icon.png";
import favicon32 from "./images/favicon/favicon-32x32.png";
import favicon16 from "./images/favicon/favicon-16x16.png";
import faviconManifest from "./images/favicon/site.webmanifest";
import faviconSafari from "./images/favicon/safari-pinned-tab.svg";
import favicon from "./images/favicon/favicon.ico";
import "./tailwind.css";
import { ReactNode, useEffect, useRef } from "react";
import { getClientHints, type ClientHints } from "./util/getClientHints";
import { getPublicUrl } from "./util/getPublicUrl";

export const links: LinksFunction = () => [
  // Favicon
  { rel: "apple-touch-icon", sizes: "180x180", href: faviconAppleTouch },
  { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32 },
  { rel: "icon", type: "image/png", sizes: "16x16", href: favicon16 },
  { rel: "manifest", href: faviconManifest },
  { rel: "mask-icon", color: "#5bbad5", href: faviconSafari },
  { rel: "shortcut icon", href: favicon },

  // Styles
  { rel: "stylesheet", href: styles },
];

export const meta: MetaFunction = () => [
  { title: "Building Healthy Homes" },
  { name: "description", content: "Nopal builds healthy homes for humans" },
  {
    name: "keywords",
    content:
      "Home, House, Build, High Performance, Health, Sustainable, Natural Materials",
  },
];

export const headers = () => ({
  // Enables client hints for the Sec-CH-Prefers-Color-Scheme header
  "Accept-CH": "Sec-CH-Prefers-Color-Scheme",
});

function GlobalLoadingBar() {
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const barRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    if (!barRef.current) return;
    const bar = barRef.current;

    if (isLoading) {
      let width = 0;
      bar.style.opacity = "1";
      bar.style.width = "0%";

      const animate = () => {
        if (width < 90) {
          // Fast at first, then slow down as it approaches 90%
          width += (90 - width) * 0.03;
          bar.style.width = `${width}%`;
        }
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      bar.style.width = "100%";
      bar.style.transition = "width 200ms ease-out";
      const timeout = setTimeout(() => {
        bar.style.opacity = "0";
        bar.style.transition = "opacity 300ms ease-out";
        setTimeout(() => {
          bar.style.width = "0%";
          bar.style.transition = "";
        }, 300);
      }, 200);
      return () => clearTimeout(timeout);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isLoading]);

  return (
    <div
      ref={barRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "3px",
        background: "linear-gradient(90deg, #7F5B8B, #A63B31)",
        zIndex: 9999,
        opacity: 0,
        width: "0%",
        pointerEvents: "none",
      }}
    />
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="msapplication-TileColor" content="#fff9f1" />
        <meta name="theme-color" content="#fff9f1" />
        <meta
          name="msapplication-config"
          content={getPublicUrl("images/favicon/browserconfig.xml")}
        />
        <Meta />
        <Links />
      </head>
      <body>
        <GlobalLoadingBar />
        {children}
        <Scripts />
        <ScrollRestoration />
      </body>
    </html>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  let heading = "Something went wrong";
  let detail: string;
  let showLogin = false;

  if (isRouteErrorResponse(error)) {
    if (error.status === 401 || error.status === 403) {
      heading = "Session expired";
      detail = "Please log in to continue.";
      showLogin = true;
    } else if (error.status === 404) {
      heading = "Page not found";
      detail = "This page doesn't exist.";
    } else {
      heading = `${error.status} ${error.statusText}`;
      detail =
        typeof error.data === "string"
          ? error.data
          : "An error occurred on the server.";
    }
  } else {
    detail =
      error instanceof Error ? error.message : "An unexpected error occurred.";
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "40px 20px",
        textAlign: "center",
        gap: "16px",
      }}
    >
      <p
        style={{
          fontFamily: "monospace",
          fontSize: "11px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--text-subtle)",
        }}
      >
        {heading}
      </p>
      <p
        style={{
          fontSize: "14px",
          color: "var(--text-subtle)",
          maxWidth: "360px",
          lineHeight: "1.5",
        }}
      >
        {detail}
      </p>
      {showLogin ? (
        <a href="/login" className="btn btn-primary">
          Go to login
        </a>
      ) : (
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      )}
    </div>
  );
}

export default function App() {
  return <Outlet />;
}

export type RootLoaderData = {
  requestInfo: { clientHints: ClientHints };
};

export async function loader({ request }: LoaderFunctionArgs) {
  return {
    requestInfo: {
      clientHints: getClientHints(request),
    },
  };
}
