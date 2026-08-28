import { Layout } from "../components/Layout";
import projectStyles from "../styles/project.css?url";
import goodsStyles from "../styles/goods.css?url";
import { LinksFunction } from "react-router";
import { FooterDiscovery } from "../components/Footer";
import { GoodContact, GoodButtonGuiding } from "../components/GoodAssets";
import { surfaceBase } from "stamps/surface.css";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: projectStyles },
  { rel: "stylesheet", href: goodsStyles },
];

export default function GoodBuilding() {
  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container mt-12 p-4">
          <h1 className="purple-light-text text-4xl">
            The Good Building Cookbook
          </h1>
          <p className="text-xl mt-4">
            Nature gives us the best ingredients. It also gives us hints as to
            how they should be used and this is where we start to define and
            create the assembly for any Nopal build.
          </p>

          <h2 className="green-text text-3xl mt-12">Nopal's Recipes</h2>

          <div className="flex flex-col sm:flex-row gap-4 mt-4">
            <div className={`build-recipe basis-1/2 font-mono p-4 ${surfaceBase}`}>
              <h4 className="font-bold">Sunny Home Recipe</h4>
              <dl className="mt-4">
                <dd>$500k+</dd>
                <dd>1500-2500 sq/ft</dd>
                <dd>Sonoran Desert</dd>
                <dd>Remote Buildable.</dd>
              </dl>
            </div>

            <div className={`build-recipe basis-1/2 font-mono p-4 ${surfaceBase}`}>
              <h4 className="font-bold">Sunny ADU Recipe</h4>
              <dl className="mt-4">
                <dd>$200k+</dd>
                <dd>250-1500 sq/ft</dd>
                <dd>Sonoran Desert</dd>
                <dd>Remote & DIY Buildable.</dd>
              </dl>
            </div>
          </div>
          <p className="text-xl mt-4 mb-4">
            All our recipes are high performance and much more sustainable than
            the typical construction.
          </p>

          <h2 className="green-text text-3xl mt-12">Custom Recipes</h2>

          <div className="flex flex-col sm:flex-row gap-4 mt-4">
            <div className={`build-recipe basis-1/2 font-mono p-4 ${surfaceBase}`}>
              <h4 className="font-bold">[Your Home Recipe]</h4>
              <dl className="mt-4">
                <dd>$500k+</dd>
                <dd>[Your Size] sq/ft</dd>
                <dd>[Your Location]</dd>
                <dd>[Your Wishes]</dd>
                <dd>[Your Dreams]</dd>
              </dl>
            </div>
          </div>

          <p className="text-xl mt-4 mb-4">
            Those wishes and dreams of yours are important and help us guide you
            to a home aligned closer to you.
          </p>

          <p className="text-lg italic purple-light-text mt-8">
            Hint: We can collaborate with your team also!
          </p>

          <GoodContact>
            <GoodButtonGuiding />
          </GoodContact>
        </div>
      </div>
      <FooterDiscovery
        to="/grandpas-cabin-recipe"
        label="Grandpa's Cabin Recipe!"
      >
        <svg
          className="mt-8"
          width="71"
          height="63"
          viewBox="0 0 71 63"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M40 62.5C29 55 13.5 44 2.5 48.5C10 35 23 18.5 35.5 6.5C39.1 10.5 61.3333 14.8333 70.5 18C64.5 23.5 40 49 40 62.5Z"
            fill="#3F2B46"
            fillOpacity="0.26"
          />
          <path
            d="M40 57C27.6 50.2 12 45 2 42.4998C15.5 31 22 13 34.5 1C38.1 5 57.3333 9.33333 66.5 12.5C61 28.5 47.5 44.5 40 57Z"
            className="farground-fill"
          />
          <path
            d="M33 10C37.8333 11.1667 39.6 12.8 45 14M26.5 18C31.6667 20.8333 53 29.1 53 27.5M21 26C26.1667 28.8333 38.5 31 47.5 35.5M23 22.5C30 24.5 38.5 27.5 49.5 32M42.5 45.5L40 43.2273M14.5 35.5H18M18 35.5H31.5L40 43.2273M18 35.5L14.5 39.5M40 43.2273L37.5 48M2 42.4998C12 45 27.6 50.2 40 57C47.5 44.5 61 28.5 66.5 12.5C57.3333 9.33333 38.1 5 34.5 1C22 13 15.5 31 2 42.4998Z"
            className="foreground-stroke"
          />
        </svg>
      </FooterDiscovery>
    </Layout>
  );
}
