// app/components/MakerErrorBoundary.tsx
// What the Maker's pages show when a loader refuses: 403 for someone the
// Maker isn't for, 404 for a page or tab they aren't given, and the plain
// error otherwise. Without this a thrown 403 falls to the root boundary,
// which reads it as an expired session.
import { Link, isRouteErrorResponse, useRouteError } from "react-router";
import { AppLayout } from "./AppLayout";
import { Badge } from "stamps/Badge";
import { surfaceBase } from "stamps/surface.css";
import { link } from "stamps/link.css";
import { textSize } from "stamps/typography.css";

export function MakerErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const copy =
    status === 403
      ? { title: "Access Denied", text: "The Maker is for admins and guides." }
      : status === 404
        ? { title: "Nothing here", text: "There's no page at this address." }
        : {
            title: "Something went wrong",
            text: isRouteErrorResponse(error) ? `${error.status}: ${error.statusText}` : error instanceof Error ? error.message : "An unexpected error occurred.",
          };
  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-12" style={{ maxWidth: "480px" }}>
        <div className={`${surfaceBase} p-6 flex flex-col gap-3`}>
          {status && <Badge variant={status === 403 ? "danger" : "neutral"}>{status}</Badge>}
          <h1 className="font-bold text-xl">{copy.title}</h1>
          <p className="text-sm subtle-text">{copy.text}</p>
          <Link to="/" className={`${link} ${textSize.sm}`}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
