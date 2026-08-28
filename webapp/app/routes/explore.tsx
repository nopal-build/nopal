import { LinksFunction } from "react-router";
import { Layout } from "../components/Layout";
import { Footer } from "../components/Footer";

import exploreStyles from "../styles/explore.css?url";
import { NavLink } from "react-router";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: exploreStyles },
];

export default function Explore() {
  return (
    <Layout>
      <div className="explore-bg">
        <div className="mt-20">
          <div className="container mx-auto px-4">
            <h2 className="text-4xl explore-title">
              We build a future with nature.
            </h2>
            <p className="mt-4 mb-4 text-lg max-w-lg">
              Smaller homes bring families together all while nestling better
              into the landscape.
            </p>
            <div className="example-home">
              <div className="example-home-arrow text-md">
                Example home <div className="arrow" />
              </div>
              <div className="example-home-img" />
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 flex md:justify-end">
          <div className="md:w-1/2">
            <div>
              <span className="text-2xl explore-title">Simple, eh?</span>
              <p className="mt-4 text-lg max-w-lg">
                A basic form factor allows us to build with better materials,
                resulting in a surprisingly comfortable and healthy space.
              </p>
            </div>
            <div className="home-size-ranges">
              <div className="sq-ft-range">1,536 - 2,400 sq/ft</div>
              <div className="width explore-title">
                32 - 40’
                <div />
              </div>
              <div className="depth explore-title">
                <div />
                48 - 60’
              </div>
            </div>
          </div>
        </div>

        <div className="mt-20 container mx-auto px-4">
          <h3 className="text-4xl explore-title">
            Clean Air, Healthy Building.
          </h3>
        </div>
      </div>
      <div className="container mx-auto px-4">
        <p className="mt-4 text-lg">
          Air quality plays a big role in our lives. From wild fires to city
          smog, clean air can prevent you from getting or staying sick.
        </p>
      </div>

      <div className="scene1">
        <div className="air-arrows container mx-auto mt-2 px-4" />
        <div className="sm:flex -mt-6 container mx-auto px-4 flex-wrap gap-4 z-10 relative">
          <div style={{ maxWidth: "360px" }} className="md:w-1/2">
            <h4 className="text-2xl explore-sub-title">
              Tight Building Envelope
            </h4>
            <ul className="list-disc list-inside">
              <li>Filter incoming air</li>
              <li>Reduces exterior noise</li>
              <li>Lower energy consumption</li>
            </ul>
          </div>
          <div style={{ maxWidth: "384px" }} className="mt-8 sm:mt-0">
            <h4 className="text-2xl explore-sub-title">Natural Materials</h4>
            <ul className="list-disc list-inside">
              <li>Lower environmental impact</li>
              <li>Less toxic (lower VOCs)</li>
              <li>More durable and easier to maintain</li>
            </ul>
          </div>
          <div style={{ maxWidth: "360px" }} className="mt-8">
            <NavLink
              className="btn-primary"
              to="/uncooked/newspaper-clipping-no-1"
            >
              Sqeaky clear air
            </NavLink>
            <p className="mt-4">
              We explore what it means to dilute and filter air and the impact
              it can have on our lives.
            </p>
          </div>
        </div>
      </div>

      <Footer title="Curious?">
        Let’s learn together.
        <br />
        We invite you to join the discussion below.
      </Footer>
    </Layout>
  );
}
