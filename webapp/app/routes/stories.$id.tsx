import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { Link, useLoaderData } from "react-router";
import { getStoryBySlug } from "../data/notion/stories.server";
import { LinksFunction } from "react-router";
import { Breadcrumb } from "../components/Breadcrumb";
import healthStyles from "../styles/health.css?url";
import { NotionPageDetails } from "../components/NotionPageDetails";
import { getCacheControlHeader } from "../util/getCacheControlHeader.server";
import { HealthItem } from "../routes/health.($key)";

export function headers() {
  return {
    "Cache-Control": getCacheControlHeader(),
  };
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: healthStyles },
];

type Story = Awaited<ReturnType<typeof getStoryBySlug>>;

export async function loader(context: LoaderFunctionArgs) {
  const id = context.params?.id;
  if (!id) {
    return redirect("/health");
  }
  const story = await getStoryBySlug(id);
  return { story };
}

export default function StoryId() {
  const { story } = useLoaderData<{ story: Story }>();
  if (!story) {
    return null;
  }

  const { name, pageDetails } = story;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <div className="mt-12">
            <Breadcrumb>
              <Link to={"/health"}>All Stories</Link>
            </Breadcrumb>
          </div>
          <div className="flex items-center justify-between mb-8">
            <h1 className="mr-4 purple-light-text text-4xl">{name} </h1>
          </div>

          <NotionPageDetails pageDetails={pageDetails} />
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
