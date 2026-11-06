// app/routes/public.letter.$fileId.tsx
// A letter as it was sent (`sentCopyOf`). Four doors, in order: the
// link on, anyone with the URL, no login; the worker printing a sent
// letter under a render pass (`letterRenderPass.server.ts`); someone on
// the project (a Client included) logged in, once the letter is sent; a
// Guide logged in, the draft as a preview. 404 for anyone else, the same as a file
// that doesn't exist. Rendered the way the website renders a page
// (`WebsitePageContent` + the website directive registry), with no Vault
// chrome: a contractor sees the finished page and nothing else.
//
// Read only by construction: this module exports a loader and meta and
// no action, the renderer gets no `annotations` (no pen) and no
// `interactive`. The loader returns a fixed set of fields
// (`letterPage`); file URLs point at the letter's own routes,
// and `servedFileIds={{}}` makes a `::file{}` directive draw without its
// picture rather than through a login-only URL (as the shared Efforts
// page does). A `::video{fileId="..."}` directive isn't a literal file
// URL `servedFileIds` can intercept (its `<video src>` is built at render
// time, `OxRenderer.tsx`'s `VideoDirectiveStatic`) -- `videoViewUrl`
// points it at the letter's own route instead, and `letterFileIds`
// (`letters.server.ts`) separately allows the id through server-side.
//
// Around the letter (Austin, 2026-11-05; `letterReading.server.ts`): who
// it is from, for every reader; and for someone on the project who is
// shown it, the house it went to. One letter at a time: no thread, no
// quoted text, nothing under the open letter. And no Reply: writing back
// is a new letter started at the desk, never a button here ("that feels
// like an email").
//
// Opening this page is what lowers the reader's own mailbox flag for the
// letter, and nothing else does (the mailbox's list doesn't). It is a
// write in a loader, on purpose: there is no action here, and the write
// is the reader's alone. It happens above the doors, since the link-on
// door answers before anyone is asked who they are; never under a render
// pass, for a preview, on a prefetch, or for an admin viewing as someone.
//
// The PDF is this page, printed by the worker (`letterPdf.server.ts`);
// the download links take Stamps' `hideInPrint` so the file carries no
// button to itself, and `oxmarkdown.css` sets the type for paper.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { resolveLetterPage, resolveLetterForManager, resolveSentLetter, resolveSentLetterForMember, resolveSharedLetter, type LetterPage } from "robustness-core/data/letters.server";
import { readLetter, type LetterReading } from "robustness-core/data/letterReading.server";
import { HOUSE_LABEL } from "robustness-core/data/letterHouses";
import { requestHasRenderPass } from "robustness-core/data/letterRenderPass.server";
import type { Human } from "robustness-core/data/humans.server";
import type { FileRef, VaultFolder } from "robustness-core/data/vault.types";
import { getUser, isImpersonating } from "../modules/auth/auth.server";
import { AuthShell } from "../components/AuthShell";
import OxRenderer from "../components/OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { buildLoadCellGraphDirectiveRegistry } from "../oxmarkdown/loadCellGraphDirective";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import { sprinkles } from "stamps/sprinkles.css";
import { textSize } from "stamps/typography.css";
import { semanticColors } from "stamps/tokens";
import { hideInPrint } from "stamps/print.css";

const NO_READING: LetterReading = { from: null, toHouse: null };

/** The page with what goes around the letter for this reader
 * (`readLetter`). `person` is the signed-in reader when this request is
 * their own opening of the letter, which lowers their flag for it. */
async function opened(found: { file: FileRef; project: VaultFolder }, page: LetterPage, viewer: Human | null, person: boolean) {
  return { ...page, ...(await readLetter(found.file, found.project, viewer, { lowers: person })) };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const origin = new URL(request.url).origin;
  const shared = params.fileId ? await resolveSharedLetter(params.fileId) : null;
  const rendering = !!params.fileId && (await requestHasRenderPass(request, params.fileId));
  // A person's own opening: signed in, a plain GET, not the worker's
  // render, not a prefetch, and not an admin viewing as them.
  const user = rendering ? null : await getUser(request);
  const person = !!user && request.method === "GET" && !/prefetch/i.test(request.headers.get("Sec-Purpose") ?? request.headers.get("Purpose") ?? "") && !(await isImpersonating(request));
  // The whole of what leaves the server (`letterPage`, resolved via
  // `resolveLetterPage` so a `::LoadCellGraph{fileId="..."}` directive in
  // the body renders for real instead of showing as an unknown block).
  // The link on: anyone, no login. Someone on the project who opens it
  // this way has still opened it.
  if (shared) return opened(shared, await resolveLetterPage(shared.file, origin), user, person);
  // Link off, sent: the worker printing it, with no session.
  const printing = params.fileId && rendering ? await resolveSentLetter(params.fileId) : null;
  if (printing) return opened(printing, await resolveLetterPage(printing.file, origin), null, false);
  // Link off, sent: someone on the project reads the sent copy logged
  // in, the pictures served by the letter's own routes with the session.
  // A letter the guides sent the guides is not there for a Client
  // (`resolveSentLetterForMember`).
  const sent = user && params.fileId ? await resolveSentLetterForMember(params.fileId, user._id) : null;
  if (sent) return opened(sent, await resolveLetterPage(sent.file, origin), user, person);
  // Not sent: a Guide on the project still sees the page as the client
  // will (the tab's title always opens this), with the session serving
  // the pictures and no downloads. Anyone else: not found, as before.
  const mine = user && params.fileId ? await resolveLetterForManager(params.fileId, user) : null;
  if (!mine) throw new Response("Not Found", { status: 404 });
  return { ...(await resolveLetterPage(mine.file, origin, true)), ...NO_READING };
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Not found" }];
  const description = data.preview ? `Updated ${data.updated}` : `Sent ${data.updated}`;
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

export default function PublicLetterPage() {
  const { title, showTitle, updated, resent, body, downloadUrl, pdfUrl, preview, loadCellGraphs, videoViewUrlBase, from, toHouse } = useLoaderData<typeof loader>();
  // The letter's own `/api/letter/:fileId/download` route already encodes
  // its fileId (`downloadUrl` above) -- a `::LoadCellGraph{...}`'s raw/
  // cleaned CSV downloads from the SAME route family, just one path
  // segment deeper (`.../download/:id`, `api.letter.$fileId.download.$id.tsx`),
  // so no separate fileId needs threading through here -- EXCEPT in
  // `preview` (a Guide looking at an unsent draft): that letter-scoped
  // route can't admit an unsent draft at all (`letterAttachmentFile`'s own
  // `resolveReadableLetter` has no "manager preview" door, same as the
  // existing `letterPageFile`), which is exactly why `preview`'s own body
  // keeps ORDINARY `/api/vault/view/<id>` picture URLs instead of
  // letter-scoped ones -- "the session serving the pictures" `LetterPage`
  // itself documents. Omitting `downloadUrl` entirely here (rather than
  // passing `null`) falls through to `LoadCellGraphCard`'s own default,
  // the SAME ordinary authenticated `/api/vault/download/:fileId` route
  // the Sensor Data tab uses -- works for a preview because the Guide
  // already has real vault access to their own project's files.
  const loadCellDirectives = buildLoadCellGraphDirectiveRegistry(
    loadCellGraphs,
    preview ? undefined : { downloadUrl: (id) => `${downloadUrl}/${id}` },
  );
  return (
    <AuthShell maxWidth="820px">
      {/* One column for everything: who it is from and the letter share
          the letter's own inset, so the lines above start where the
          words do. */}
      <WebsitePageContent>
      {/* The file's own `# ` heading is the title when it has one; the
          header repeats nothing. */}
      <header className={sprinkles({ mb: 8 })}>
        {showTitle && <h1 className={`${textSize["2xl"]} ${sprinkles({ fontWeight: "bold" })}`}>{title}</h1>}
        {/* Who wrote it, for every reader; where it went, for someone on
            the project it is shown to. */}
        {from && (
          <p className={textSize.sm} data-letter-from>
            From {from}
            {toHouse && `, to ${HOUSE_LABEL[toHouse]}`}
          </p>
        )}
        <p className={textSize.xs} style={{ color: semanticColors.textSubtle }}>
          {preview ? `Updated ${updated}` : `Sent ${updated}`}
          {resent && <span data-resent>{" · "}updated</span>}
          {preview && <span data-preview-note>{" · "}Only Guides can see this until it's sent.</span>}
          {!preview && (
            /* The PDF is the download; the source is the quieter second
               option. Offered on any sent copy: the worker prints a
               link-off letter under a render pass, and both routes admit
               someone on the project. */
            <span className={hideInPrint}>
              {" · "}
              <a href={pdfUrl}>Download PDF</a>
              {" · "}
              <a href={downloadUrl} style={{ color: semanticColors.textSubtle }}>
                markdown source
              </a>
            </span>
          )}
        </p>
      </header>
        <OxRenderer
          markdown={body}
          directives={{ ...buildWebsiteDirectiveRegistry({ dailyLogEntries: {} }), ...loadCellDirectives }}
          servedFileIds={{}}
          videoViewUrl={videoViewUrlBase ? (id) => `${videoViewUrlBase}/${id}` : undefined}
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
          This page doesn't exist, or hasn't been sent.
        </p>
      </div>
    </AuthShell>
  );
}
