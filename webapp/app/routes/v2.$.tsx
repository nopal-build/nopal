// app/routes/v2.$.tsx — every other `/v2/*` page. Resolves the splat path
// against the primary website project's folder tree (see
// `website.server.ts`'s `resolveWebsitePageByPath`) — a folder segment
// walks the tree, the last segment may match a plain `.md` file, and
// running out of segments inside a folder lands on that folder's own
// `README.md`. A real 404 (not a soft "not found" page) on no match, same
// as any other route.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { loadWebsitePage } from "../modules/website/loadWebsitePage.server";
import { WebsitePageView, buildWebsiteMeta } from "../components/WebsitePageView";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const segments = (params["*"] ?? "").split("/").filter(Boolean);
  return loadWebsitePage(request, segments);
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  data ? buildWebsiteMeta(data.title, data.description) : [];

export default function V2Page() {
  const { body, isDraftPreview } = useLoaderData<typeof loader>();
  return <WebsitePageView body={body} isDraftPreview={isDraftPreview} />;
}
