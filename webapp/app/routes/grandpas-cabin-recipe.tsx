import { useState } from "react";
import { Layout } from "../components/Layout";
import { FooterDiscovery } from "../components/Footer";
import { useMarkdown } from "../hooks/useMarkdown";
import { LinksFunction } from "react-router";
import markdownStyles from "../styles/markdown.css?url";
import { TextDropdown } from "../components/Dropdown";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: markdownStyles },
];

const md = `# Grandpa's Cabin Recipe

Back in my day, we had balloon framing. This had issues with fire since it was so easy for fire to travel from the wall to the roof. Eventually this leads to our modern stick framing approach you see on most sites.


### Timber Framing
Before that, many buildings were built with larger timbers that took more time and more people with specialized woodworking knowledge. While these building will last centuries, they were more costly to construct.

In the 1930s, post-frame construction came onto the scene what was an ideal approach to large structures.

Each of the modern day equivalents have improvements both to just the framing but how we make the buildings more performant and longer lasting.

### MTF
It seems like what this *fancy pants* **Nopal** company has done with **Medium Timber Framing** (MTF) is combine some of the best elements from each of these framing approaches:

- Improves the health and structure of the building.
- Requires fewer people.
- Human movable prefabrication.
- Remote Location & DIY friendly.
- Uses off the shelf materials.
- Improves maintainability of the home.

Sure it’s not perfect solution for all buildings, but for my cabin, it'll be a great solution!`;

export default function GrandpasCabinRecipe() {
  const mdHtml = useMarkdown(md);

  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container markdown px-2 pt-8 pb-20">
          {mdHtml}
          <div className="purple-light-text text-2xl">
            <em>
              -With love,
              <br />
              Grandpa
            </em>
          </div>
        </div>
      </div>
      <FooterDiscovery />
    </Layout>
  );
}

function CabinRecipe() {
  const widths = [32, 36, 40, 44, 48];
  const lengths = [52, 56, 60, 64, 68];
  const [width, setWidth] = useState(widths[1]);
  const [length, setLength] = useState(lengths[1]);

  return (
    <>
      <h2>MTF Materials</h2>

      <div>
        For a building that is{" "}
        <TextDropdown label={width + "'"}>
          <RenderNumberList list={widths} onClick={setWidth} />
        </TextDropdown>{" "}
        by{" "}
        <TextDropdown label={length + "'"}>
          <RenderNumberList list={lengths} onClick={setLength} />
        </TextDropdown>
        :
      </div>

      <ul className="mt-4">
        <li>2x6 Lumber from local big box</li>
        <li>2x4 Lumber "" "" "" ""</li>
        <li>Glue</li>
        <li>Nails</li>
        <li>Screws</li>
        <li>Clamps (for gluing)</li>
        <li>Saw</li>
        <li>Hammer</li>
        <li>Drill</li>
      </ul>
      <h2>Instructions</h2>
      <p>
        <em>Posts</em> can be created offsite but it is optional. Like a
        post-framed building, our posts are designed to bear the load of the
        building at 4' on center while reducing the thermal bridging by 2.5x of
        traditional framing.
      </p>
      <p>The tennons function as quick assembly points.</p>
      <h4>Precut Spacers</h4>
      <p>
        There are 4 spacers for each section, all these can be precut to the
        specified size.
      </p>
      <h3>Onsite Instructions</h3>
    </>
  );
}

function RenderNumberList({
  list,
  onClick,
}: {
  list: number[];
  onClick: (index: number) => void;
}) {
  return list.map((n) => {
    return (
      <li key={n}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.currentTarget?.blur();
            onClick(n);
          }}
        >
          {n}'
        </a>
      </li>
    );
  });
}
