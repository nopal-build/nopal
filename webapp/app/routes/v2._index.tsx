// app/routes/v2._index.tsx — the `/v2` homepage: the primary website
// project's own README.md (see `website.server.ts`'s
// `resolveWebsitePageByPath`, called here with zero path segments).
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { loadWebsitePage } from "../modules/website/loadWebsitePage.server";
import { WebsitePageView, buildWebsiteMeta } from "../components/WebsitePageView";

export async function loader({ request }: LoaderFunctionArgs) {
  return loadWebsitePage(request, []);
}

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  data ? buildWebsiteMeta(data.title, data.description) : [];

export default function V2Index() {
  const { body, isDraftPreview } = useLoaderData<typeof loader>();
  return <WebsitePageView body={body} isDraftPreview={isDraftPreview} />;
}
