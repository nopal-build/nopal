import { Link } from "react-router";
import { Layout } from "../components/Layout";
import { FooterDiscovery } from "../components/Footer";
import { LinksFunction } from "react-router";
import projectStyles from "../styles/project.css?url";
import { link } from "stamps/link.css";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: projectStyles },
];

export default function About() {
  return (
    <Layout>
      <div className="scene1">
        <div className="simple-container p-4">
          <h1 className="purple-light-text text-4xl">Who We Are</h1>
          <p className="text-xl mt-4 mb-4">
            Nature guides and inspires Nopal, from the materials we use and how
            we assemble them to the way we collaborate with other humans and the
            land.
          </p>
          <p className="text-xl mt-4 mb-4">
            Austin, James, Gerald and Lucas came together to weave our
            experience into comprehensive services to help others build and live
            a rich and calm life.
          </p>
          <p className="text-xl mt-4 mb-4">
            We've created the 5 factors of good building to guide us to be
            responsible stewards of the regenerative housing movement.
          </p>
          <h2 className="green-text text-3xl mt-20">Folks</h2>
          <Profile name="Austin Trautman" title="CEO" image="/about/austin.png">
            <p className="text-xl mt-4 mb-4">
              Sitting on a beach at the bottom of the Grand Canyon, 3 days from
              my last indoor meal, I had a realization. Magical things happen on
              days that start and end in nature, void of connection to the
              modern world. My brain was at total ease, I felt more....human, my
              challenges were clear, the world was all in balance. The power of
              “the middle day” has fascinated me for two decades, now confirmed
              by{" "}
              <a
                className={link}
                href="https://huckberry.com/journal/posts/3-days?srsltid=AfmBOoomKIjGbRnKP6VBR2xkPF2gcDisb5MapqEFNV_3iqnxSsUG6Hbq"
                target="_blank"
                rel="noopener noreferrer"
              >
                recent scientific findings
              </a>
              .
            </p>

            <p className="text-xl mt-4 mb-4">
              While intense curiosity has driven me down many rabbit holes over
              the past 15 years. One question has always floated above the rest;{" "}
              <em>“how do we bring the magic of nature into our homes?”</em>
            </p>
          </Profile>
          <Profile
            name="James Werhanowicz"
            title="Architect & GC"
            image="/about/james.png"
          >
            <p className="text-xl mt-4 mb-4">
              The historical concept of a “master builder” has intrigued me
              since I first heard of it in school. The idea that one individual
              could invent an initial design concept of what a building or space
              could be, conceptually evolve that imagination to a point where
              physical construction becomes possible, and then totally change
              mediums and work with craftsmen, trades, and the physical
              materials necessary to bring that idea into reality, is
              astounding. The vision, commitment, and metal focus required would
              have to bordered insanity, not to mention the obsessive seeking of
              prior knowledge that must been necessary to create an individual
              who even possessed the ability to perform all those tasks.
            </p>
          </Profile>
          <Profile
            name="Gerald Leenerts"
            title="Systems Craftsman"
            image="/about/gerald.png"
          >
            <p className="text-xl mt-4 mb-4">
              Back on my Grandpa's farm, I fell in love with nature without
              knowing it. It wasn't a specific aspect but rather the collective.
              Sometimes nature was full of life and other times it struggled to
              survive. Worst was to see how we humans tried to force nature to
              adapt to our approach to life.
            </p>
            <p className="text-xl mt-4 mb-4">
              <a
                className={link}
                href="https://www.goodreads.com/book/show/3828902-thinking-in-systems"
                target="_blank"
                rel="noopener noreferrer"
              >
                Thinking in systems
              </a>{" "}
              is direct reflection of my interest and love for nature. I am
              constantly playing with natural materials as I look to answer my
              question;{" "}
              <em>
                "Is it possible to create a home that is focused on modern human
                comfort while also being considerate of our climate?"
              </em>
            </p>
          </Profile>
          <Profile
            name="Lucas Johnson"
            title="Chief Building Nerd"
            image="/about/lucas.png"
          >
            <p className="text-xl mt-4 mb-4">
              Laying in a hospital bed beneath synthetic light. I kept thinking
              how on earth am I expected to heal in a building this bad?
              Realizing I needed to drop my path to medical school to create
              healthy buildings that are connected to nature.
            </p>
            <p className="text-xl mt-4 mb-4">
              Suddenly I was deeply emerged in the Costa Rican wilderness on a
              tropical biology study abroad program. Reconnecting to my
              childhood roots digging in the dirt, camping, hiking, and playing
              in nature. Feeling healthier than I had in years. It became
              obvious that we needed to make buildings places centered around
              healing while minimizing their impact to people and the planet.
            </p>
            <p className="text-xl mt-4 mb-20">
              This core realization led me to spending the last two decades as a
              building scientist focused on creating the healthiest buildings
              with the lowest lifecycle carbon impact.
            </p>
          </Profile>

          <div className="mt-16">
            <Link to="/contact" className="btn-primary">
              Contact us
            </Link>
          </div>
        </div>
      </div>
      <FooterDiscovery />
    </Layout>
  );
}

function Profile({
  name,
  image,
  title,
  children,
}: {
  name: string;
  image: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="profile mt-8 mb-20">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-end mb-8">
        <img src={image} title={name} />
        <div>
          <h3 className="font-bold text-xl">{name}</h3>
          <div className="purple-light-text">{title}</div>
        </div>
      </div>
      {children}
    </div>
  );
}
