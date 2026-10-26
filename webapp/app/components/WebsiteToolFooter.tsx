// app/components/WebsiteToolFooter.tsx
//
// Renders the website project's shared `_footer.md` (see
// `loadWebsiteFooter.server.ts`) at the bottom of a real app route (tools/
// waiver) that isn't itself Vault-backed markdown content — the same
// treatment `WebsitePageView` gives every OTHER `/v2/*` page's own
// `::include-ox{file="./_footer.md"}`, just invoked directly since these
// pages have no body of their own for that directive to live in.
import OxRenderer from "./OxRenderer";
import { buildWebsiteDirectiveRegistry } from "../oxmarkdown/websiteDirectives";
import { WebsitePageContent } from "stamps/WebsitePageContent";
import type { LoadedWebsiteFooter } from "../modules/website/loadWebsiteFooter.server";

export function WebsiteToolFooter({ footer }: { footer: LoadedWebsiteFooter }) {
  if (!footer.body) return null;
  const directives = buildWebsiteDirectiveRegistry({ dailyLogEntries: footer.dailyLogEntries });
  return (
    <WebsitePageContent>
      <OxRenderer
        markdown={footer.body}
        directives={directives}
        className="ox-no-heading-marks ox-no-dots website-page-ox"
      />
    </WebsitePageContent>
  );
}
