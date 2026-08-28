import { Layout } from "../components/Layout";
import { FooterDiscovery } from "../components/Footer";
import {
  Outlet,
  NavLink,
  useNavigate,
  useLocation,
  useLoaderData,
} from "react-router";
import { GbScore } from "../components/GbScore";
import { LinksFunction } from "react-router";
import healthStyles from "../styles/health.css?url";
import {
  HealthFactor,
  EfficiencyFactor,
  LongevityFactor,
  CarbonFactor,
  SocialEquityFactor,
} from "../components/FiveFactors";
import { getSampleSciences } from "../data/notion/science.server";
import { getAllStories } from "../data/notion/stories.server";
import type { Collection } from "robustness-core/data/generic.server";
import type {
  StoryRecord,
  ScienceRecord,
  RichText,
} from "../data/notion/types";
import { NotionText } from "../components/NotionText";
import { useState } from "react";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: healthStyles },
];

type LoaderResult = {
  stories: Collection<StoryRecord>;
  science: Collection<ScienceRecord>;
};
export const loader = async () => {
  const [stories, science] = await Promise.all([
    getAllStories(),
    getSampleSciences(),
  ]);
  return { science, stories };
};

const MAX_STUDIES = 2;
export default function Health() {
  const navigation = useNavigate();
  const location = useLocation();
  const { science, stories } = useLoaderData<LoaderResult>();
  const [showStudies, setShowStudies] = useState(false);

  const hasStories = stories.data.length > 0;

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <h1 className="purple-light-text text-4xl mt-12">
            The Good Building Score
          </h1>
          <div className="flex flex-wrap">
            <div className="flex gap-2 mt-4 mr-2">
              <GbScore score={0} />
              <GbScore score={5} />
              <GbScore score={15} />
              <GbScore score={25} />
            </div>
            <div className="flex gap-2  mt-4">
              <GbScore score={35} />
              <GbScore score={45} />
              <GbScore score={50} />
            </div>
          </div>

          <div className="mt-4 relative">
            <p className="text-xl">
              We review <b>materials & assemblies</b> by looking at 5 Factors:
            </p>
            <div className="flex gap-8 items-center">
              <div className="flex flex-col gap-4 mt-4 w-2/3">
                <div>
                  <HealthFactor verbose={true} score={7} />
                </div>
                <div>
                  <EfficiencyFactor score={4} />
                </div>
                <div>
                  <LongevityFactor score={8} />
                </div>
                <div>
                  <SocialEquityFactor score={5} />
                </div>
                <div>
                  <CarbonFactor score={3} />
                </div>
              </div>
              <div className="relative font-hand text-2xl red-text w-1/3">
                <svg
                  width="141"
                  height="50"
                  viewBox="0 0 141 50"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M139.735 49.6558C139.735 49.6558 96.1783 -7.46098 39.4723 1.77095C23.7951 4.32325 0.999983 14.9669 0.999983 14.9669M0.999983 14.9669L14.6331 21.2011C16.2761 21.9524 17.9943 20.3127 17.3206 18.6364L10.6387 2.01035C9.98339 0.379903 7.69482 0.326392 6.96406 1.92443L0.999983 14.9669Z"
                    className="red-stroke"
                  />
                </svg>
                We rate each factor out of 10.
              </div>
            </div>
            <p className="text-xl mt-6">
              Before you get to that information, we recommend looking at our{" "}
              <b>stories</b> and <b>case studies</b> where we examine real-world
              projects.
            </p>
          </div>

          {hasStories && (
            <>
              <h2 className="green-text text-4xl mt-12">Stories</h2>
              <div className="font-hand red-text text-2xl">
                Our journey to building Arizona's healthiest homes
              </div>
              <div>
                {stories.data.map((story) => {
                  return (
                    <TastingItem
                      key={story._id}
                      img={story.thumbnail}
                      title={story.name}
                      description={story.summary}
                      annotation={story.annotation}
                      onClick={() => {
                        navigation(`/stories/${story.slug}`);
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}

          <h2 className="green-text text-4xl mt-12">Applied Science</h2>
          <div className="font-hand red-text text-2xl">
            Exploring different building assemblies and materials!
          </div>
          <div>
            {science.data
              .filter((_, x) => showStudies || x < MAX_STUDIES)
              .map((tasting) => {
                return (
                  <TastingItem
                    key={tasting._id}
                    img={tasting.thumbnail}
                    title={tasting.name}
                    description={tasting.summary}
                    scores={tasting.scores || []}
                    annotation={tasting.annotation}
                    onClick={() => {
                      navigation(`/science/${tasting.slug}`);
                    }}
                  />
                );
              })}
            {!showStudies && science.data.length > MAX_STUDIES && (
              <div className="flex items-center mt-4 gap-2">
                <svg
                  width="23"
                  height="15"
                  viewBox="0 0 23 15"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M21.5294 9.02936L16.8237 4.3237C15.5462 3.04622 13.3638 3.98314 13.4101 5.78918L13.5747 12.2075C13.6198 13.9641 15.7458 14.813 16.9883 13.5704L21.5294 9.02936ZM21.5294 9.02936L6.99998 9.04701C6.99998 9.04701 0.999998 9.04701 0.999998 0.500002"
                    className="purple-light-stroke"
                  />
                </svg>
                <button
                  className="btn-yellow"
                  onClick={() => setShowStudies(true)}
                >
                  More studies
                </button>
              </div>
            )}
          </div>

          <div className="folder-tabs mt-12">
            <NavLink
              preventScrollReset={true}
              prefetch="intent"
              className={() => {
                if (/^\/health(\/assemblies)??\/?$/.test(location.pathname)) {
                  return "active";
                }
                return "";
              }}
              to={"/health"}
            >
              Assemblies
            </NavLink>
            <NavLink
              preventScrollReset={true}
              prefetch="intent"
              to={"/health/materials"}
            >
              Materials
            </NavLink>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Outlet />
          </div>
        </div>
      </div>
      <FooterDiscovery />
    </Layout>
  );
}

type TastingItemProps = {
  img: string;
  title: string;
  description: RichText;
  scores?: number[];
  annotation: string;
  onClick: () => void;
};

function TastingItem({
  title,
  description,
  scores,
  img,
  annotation,
  onClick,
}: TastingItemProps) {
  return (
    <div
      className="flex gap-4 mt-4 article-item flex-col sm:flex-row"
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <div className="shrink-0">
        <img src={img} alt={title} className="rounded sm:w-52" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="purple-light-text text-2xl">{title}</h3>
        <NotionText text={description.rich_text} />
        {scores && (
          <div className="flex items-center gap-2">
            <ScienceScores scores={scores} annotation={annotation} />
          </div>
        )}
      </div>
    </div>
  );
}

function ScienceScores({
  scores,
  annotation,
}: {
  scores: number[];
  annotation: string;
}) {
  const sortedScores = scores.sort();
  if (sortedScores.length == 2) {
    const diff = sortedScores[1] - sortedScores[0];

    return (
      <>
        <GbScore score={sortedScores[0]} />
        {diff > 15 && (
          <svg
            width="26"
            height="12"
            viewBox="0 0 26 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M25.0294 6.02936L20.3237 1.32371C19.0462 0.0462249 16.8638 0.983148 16.9102 2.78919L17.0747 9.20748C17.1198 10.9641 19.2458 11.813 20.4883 10.5704L25.0294 6.02936ZM25.0294 6.02936C25.0294 6.02936 6.48377 6.06931 0.970642 6.02936"
              className="red-stroke"
            />
          </svg>
        )}
        <GbScore score={sortedScores[1]} />
        <div className="font-hand red-text text-xl">
          {diff > 15 && `+${diff}pt `}
          {annotation}
        </div>
      </>
    );
  }

  if (sortedScores.length > 2) {
    return (
      <>
        <GbScore score={sortedScores[0]} />
        <GbScore score={sortedScores[1]} />
        <GbScore score={sortedScores[2]} />
        <div className="font-hand red-text text-xl">{annotation}</div>
      </>
    );
  }
  return null;
}
