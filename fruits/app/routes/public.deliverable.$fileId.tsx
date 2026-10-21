// app/routes/public.deliverable.$fileId.tsx
// A deliverable, shared by link: anyone with the URL reads it, no login.
// On only while a Guide has turned the file's link on
// (`deliverables.server.ts`); 404 otherwise, the same as a file that
// doesn't exist. Rendered the way the website renders a page
// (`WebsitePageContent` + the website directive registry), with no Vault
// chrome: a contractor sees the finished page and nothing else.
//
// Read only by construction: this module exports a loader and meta and
// no action, the renderer gets no `annotations` (no pen) and no
// `interactive`. The loader returns a fixed set of fields
// (`deliverablePage`); file URLs point at the deliverable's own routes,
// and `servedFileIds={{}}` makes a `::file{}` directive draw without its
// picture rather than through a login-only URL (as the shared Efforts
// page does).
//
// The PDF is this page, printed by the worker (`deliverablePdf.server.ts`);
// `deliverable.css` hides the download links under print so the file
// carries no button to itself.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { bodyOpensWithTitle, deliverablePage, resolveSharedDeliverable } from "robustness-core/data/deliverables.server";
import { AuthShell } from "../components/AuthShell";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import "../styles/deliverable.css";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const shared = params.fileId ? await resolveSharedDeliverable(params.fileId) : null;
  if (!shared) throw new Response("Not Found", { status: 404 });
  // The whole of what leaves the server (`deliverablePage`).
  return deliverablePage(shared.file, new URL(request.url).origin);
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not found" }];
  const description = `Updated ${data.updated}`;
  return [
    { title: data.title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Nopal" },
    { property: "og:type", content: "article" },
    { property: "og:title", content: data.title },
    { property: "og:description", content: description },
    { property: "og:url", content: data.url },
  ];
};

export default function PublicDeliverablePage() {
  const { title, updated, body, downloadUrl, pdfUrl } = useLoaderData<typeof loader>();
  return (
    <AuthShell maxWidth="820px">
      {/* The file's own `# ` heading is the title when it has one; the
          header repeats nothing. */}
      <header className={sprinkles({ mb: 8 })}>
        {!bodyOpensWithTitle(body) && <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>{title}</h1>}
        <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          Updated {updated}
          {/* The PDF is the download; the source is the quieter second option. */}
          <span className="deliverable-actions">
            {" · "}
            <a href={pdfUrl}>Download PDF</a>
            {" · "}
            <a href={downloadUrl} style={{ color: semanticColors.textSubtle }}>
              markdown source
            </a>
          </span>
        </p>
      </header>
      <WebsitePageContent>
        <OxRenderer
          markdown={body}
          directives={buildWebsiteDirectiveRegistry({ dailyLogEntries: {} })}
          servedFileIds={{}}
          className="ox-no-dots ox-no-heading-marks website-page-ox"
        />
      </WebsitePageContent>
    </AuthShell>
  );
}

export function ErrorBoundary() {
  return (
    <AuthShell maxWidth="600px">
      <div style={{ textAlign: "center" }}>
        <h1 className="font-bold text-xl" style={{ color: semanticColors.textBrand }}>
          Not found
        </h1>
        <p className="text-sm font-mono" style={{ color: semanticColors.textSubtle }}>
          This page doesn't exist, or isn't shared.
        </p>
      </div>
    </AuthShell>
  );
}
