import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { getMaterialBySlug } from "../data/notion/materials.server";
import type { MaterialRecord } from "~/data/notion/types";
import { GbScore } from "../components/GbScore";
import { LinksFunction } from "react-router";
import { Breadcrumb } from "../components/Breadcrumb";
import healthStyles from "../styles/health.css?url";
import {
  HealthFactor,
  EfficiencyFactor,
  LongevityFactor,
  CarbonFactor,
  SocialEquityFactor,
} from "../components/FiveFactors";
import { NotionPageDetails } from "../components/NotionPageDetails";
import { getCacheControlHeader } from "../util/getCacheControlHeader.server";

export function headers() {
  return {
    "Cache-Control": getCacheControlHeader(),
  };
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: healthStyles },
];

export async function loader(context: LoaderFunctionArgs) {
  const id = context.params?.id;
  if (!id) {
    return redirect("/health");
  }
  const material = await getMaterialBySlug(id);
  return { material };
}

export default function MaterialsId() {
  const { material } = useLoaderData<{ material: MaterialRecord }>();
  const location = useLocation();
  const search = location?.search || "";
  const isTutorial = search.includes("tutorial=true");

  const {
    name,
    gbs,
    comfortScore,
    efficiencyScore,
    longevityScore,
    socialImpactScore,
    carbonScore,
    pageDetails,
  } = material;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <div className="mt-12">
            <Breadcrumb>
              <Link to={"/health"}>All Materials</Link>
            </Breadcrumb>
          </div>
          <div className="flex items-center justify-between mb-8">
            <h1 className="mr-4 purple-light-text text-4xl">{name} </h1>
            <GbScore score={gbs} />
          </div>

          <NotionPageDetails pageDetails={pageDetails} />

          <div className="flex justify-between items-end">
            <h2 className="green-text text-3xl mt-12">Scoring</h2>
            <Link
              to={isTutorial ? "" : "?tutorial=true"}
              replace
              preventScrollReset
              prefetch="intent"
              style={{ height: "28px" }}
              className="inline-flex link font-mono text-lg"
            >
              {isTutorial ? "Hide" : "Expand"}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M4 11a1 1 0 0 1 .117 1.993l-.117 .007h-1a1 1 0 0 1 -.117 -1.993l.117 -.007h1z" />
                <path d="M12 2a1 1 0 0 1 .993 .883l.007 .117v1a1 1 0 0 1 -1.993 .117l-.007 -.117v-1a1 1 0 0 1 1 -1z" />
                <path d="M21 11a1 1 0 0 1 .117 1.993l-.117 .007h-1a1 1 0 0 1 -.117 -1.993l.117 -.007h1z" />
                <path d="M4.893 4.893a1 1 0 0 1 1.32 -.083l.094 .083l.7 .7a1 1 0 0 1 -1.32 1.497l-.094 -.083l-.7 -.7a1 1 0 0 1 0 -1.414z" />
                <path d="M17.693 4.893a1 1 0 0 1 1.497 1.32l-.083 .094l-.7 .7a1 1 0 0 1 -1.497 -1.32l.083 -.094l.7 -.7z" />
                <path d="M14 18a1 1 0 0 1 1 1a3 3 0 0 1 -6 0a1 1 0 0 1 .883 -.993l.117 -.007h4z" />
                <path d="M12 6a6 6 0 0 1 3.6 10.8a1 1 0 0 1 -.471 .192l-.129 .008h-6a1 1 0 0 1 -.6 -.2a6 6 0 0 1 3.6 -10.8z" />
              </svg>
            </Link>
          </div>
          <div className="flex flex-col gap-4 mt-4">
            <div>
              <HealthFactor verbose={true} score={comfortScore} />
              {isTutorial && (
                <>
                  <p className="mt-2 font-hand red-text text-lg">
                    Air quality is our main concern with this factor. A more
                    stable tempature, proper humidity (40-60%) and low PPM, VOC
                    and C02 score higher points while more toxic materials will
                    get down ranked.
                  </p>
                  <p className="mt-4 font-hand red-text text-lg">
                    Acoustics can also play into air quality. Does this material
                    help stabilize sound for the building?
                  </p>
                  <p className="mt-4 mb-8 font-hand red-text text-lg">
                    Biophilic design helps us look at materials that are
                    visually seen. Humans have a deep intrinsic connection to
                    nature that can lead to focused attention and relaxed mental
                    states.
                  </p>
                </>
              )}
            </div>
            <div>
              <EfficiencyFactor score={efficiencyScore} />
              {isTutorial && (
                <>
                  <p className="mt-2 mb-8 font-hand red-text text-lg">
                    How does this material impact the performance of the
                    building? Reducing energy consumption is important.
                  </p>
                </>
              )}
            </div>
            <div>
              <LongevityFactor score={longevityScore} />
              {isTutorial && (
                <>
                  <p className="mt-2 font-hand red-text text-lg">
                    What is the normal time for this material to last? Less than
                    20 years is terrible while more than 100 years is amazing.
                  </p>
                  <p className="mt-4 mb-8 font-hand red-text text-lg">
                    Sometimes the difficulty of installing an material can
                    compromise its lifespan. We aren't just picking an average
                    but rather looking at it's use across the spectrum.
                  </p>
                </>
              )}
            </div>
            <div>
              <SocialEquityFactor score={socialImpactScore} />
              {isTutorial && (
                <>
                  <p className="mt-2 font-hand red-text text-lg mb-8">
                    From blood diamonds and child labor to simply installing
                    toxic materials, we look at how materials impact different
                    classes of people.
                  </p>
                </>
              )}
            </div>
            <div>
              <CarbonFactor score={carbonScore} />
              {isTutorial && (
                <>
                  <p className="mt-2 font-hand red-text text-lg">
                    This one looks at the carbon impact of the material. We can
                    calculate the embodied carbon for materials.
                  </p>
                  <p className="mt-4 font-hand red-text text-lg">
                    Embodied carbon is how much C02 is emitted during the
                    production and transportation of an material.
                  </p>
                  <p className="mt-4 font-hand red-text text-lg mb-8">
                    Operational carbon isn't considered in this factor since it
                    is bundled into the efficiency factor above.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </Layout>
  );
}
