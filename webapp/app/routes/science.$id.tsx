import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { Link, useLoaderData } from "react-router";
import { getScienceBySlug } from "../data/notion/science.server";
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

type Science = Awaited<ReturnType<typeof getScienceBySlug>>;

export async function loader(context: LoaderFunctionArgs) {
  const id = context.params?.id;
  if (!id) {
    return redirect("/health");
  }
  const science = await getScienceBySlug(id);
  return { science };
}

export default function ScienceId() {
  const { science } = useLoaderData<{ science: Science }>();
  if (!science) {
    return null;
  }

  const { name, pageDetails } = science;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <div className="mt-12">
            <Breadcrumb>
              <Link to={"/health"}>All Applied Sciences</Link>
            </Breadcrumb>
          </div>
          <div className="flex items-center justify-between mb-8">
            <h1 className="mr-4 purple-light-text text-4xl">{name} </h1>
          </div>

          <NotionPageDetails pageDetails={pageDetails} />

          <h2 className="green-text text-4xl mt-12">
            Dive Into the Assemblies
          </h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {science.assemblies.map((assembly) => {
              return (
                <HealthItem
                  key={assembly.id}
                  returnUrl={`/science/${science.slug}`}
                  type="assemblies"
                  item={assembly}
                />
              );
            })}
          </div>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
