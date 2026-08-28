import { AudioFormat } from "../components/AudioFormat";
import { NopalBusinessCycle } from "../svg/path/NopalBusinessCycle";
import {
  CactiOne,
  CactiTwo,
  CactiThree,
  CactiFour,
  CactiFive,
} from "../svg/path/cacti";
import { Annotation } from "../components/Annotation";
import { Link } from "react-router";

export default function PathPage() {
  return (
    <>
      <div className="pt-16 uncooked-markdown">
        <p>All journeys require preparation and a north star.</p>
        <Annotation>Our DNA</Annotation>
        <blockquote>
          We focus on inspiring humanity to live better by building healthy
          homes that are inspired by nature.
        </blockquote>
        <p>
          <AudioFormat href="https://www.loom.com/share/da73086bc05c485daf6ee36f81b6c1f1" />
        </p>

        <h2 className="cacti-one-heading">
          <CactiOne /> A Fragmented Understanding
        </h2>
        <p>
          Our industry has splintered into fragmented understanding. The few
          people that see the whole aren’t doing the hands on work, separated by
          regulations and meetings.
        </p>
        <p>
          Bolting on high performance has become a common path to achieve more
          resilient and healthy buildings. While the results can be positive,
          the added complexity leads to increased cost, complication and
          uncertainty.
        </p>

        <h2 className="cacti-two-heading">
          <CactiTwo />A Path Finder
        </h2>
        <p>
          At Nopal, we focus on bringing these fragments into a clear whole,
          through a complete system.
        </p>
        <ul>
          <li>Material science helps us navigate the rules & regulations</li>
          <li>
            <Link to="/path/faq-3">Atomic teams</Link> work in a bottom up
            approach, enabling craftsmanship and apprenticeship
          </li>
          <li>
            Smaller projects like ADUs & single-family homes offer quicker
            feedback loops
          </li>
        </ul>
        <p className="mb-8">
          This foundation will go into practice with our first full-system home
          build starting in Spring of 2025.
        </p>
        <NopalBusinessCycle />
        <h3 className="cacti-three-heading">
          <CactiThree />
          What We Are Looking For
        </h3>
        <p>Investors or on-contract buyers for builds #2-10.</p>

        <p>These first 10 builds enable us to:</p>
        <ul>
          <li>
            Refine our education and <Link to="/path/faq-4">community</Link>{" "}
            approach
          </li>
          <li>Grow the Team</li>
          <li>
            Level up <Link to="/path/faq-2">our Baselayer</Link> system
          </li>
          <li>Start warehousing and prefab operations</li>
          <li>Improve our project management software</li>
        </ul>
        <h3 className="cacti-four-heading">
          <CactiFour />
          The Future is Multi
        </h3>
        <p>
          Based on our research, about 12-20 homes per acre is the optimal
          American city density for thriving communities.
        </p>
        <p>
          We plan to scale to multifamily projects designed around human scale
          clusters and built by one of our{" "}
          <Link to="/path/faq-3">Atomic teams</Link>. Developing our systems and
          team approach takes time. We are pursuing slow and deliberate growth
          to build a lasting future. After our first 10 homes we look to immerse
          ourselves into the multifamily market with confidence.
        </p>
        <h3 id="faq" className="cacti-five-heading">
          <CactiFive />
          FAQ
        </h3>
        <div className="z-10 relative pb-8 faq">
          <p>
            <Link to="/path/faq-1">
              {">"} How much more does it cost to build this way?
            </Link>
          </p>
          <p>
            <Link to="/path/faq-2">{">"} What is this "Baselayer"?</Link>
          </p>
          <p>
            <Link to="/path/faq-3">{">"} What are Atomic Teams?</Link>
          </p>
          <p>
            <Link to="/path/faq-4">
              {">"} What about Community {"&"} Curiosity?
            </Link>
          </p>
          <p>
            <Link to="/path/faq-5">{">"} How quickly can we scale?</Link>
          </p>
          <p>
            <Link to="/path/faq-6">
              {">"} What type of Investor are you looking for?
            </Link>
          </p>
          <p>
            <Link to="/path/faq-7">
              {">"} How does a Nopal build fair against fire?
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
