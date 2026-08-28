import { AudioFormat } from "../components/AudioFormat";
import { Link } from "react-router";
import { BackArrow } from "../svg/arrows/BackArrow";
import {
  CactiOne,
  CactiTwo,
  CactiThree,
  CactiFour,
  CactiFive,
  CactiSix,
} from "../svg/path/cacti";

export default function PathFaqThree() {
  return (
    <div className="pt-16 uncooked-markdown">
      <h1 className="italic">
        {">"} What type of Investor are you looking for?
      </h1>
      <p>
        We are open to many types of investors or partnerships. Nopal is about
        growing construction towards good building and to achieve this we need
        strategic partners and investors that can help make that a reality.
      </p>
      <p>
        <AudioFormat />
      </p>

      <h2 className="cacti-one-heading">
        <CactiOne />
        Real Estate Investor
      </h2>
      <p>
        Initially we are looking for investors for build homes #2 - 10. Current
        build costs $850-950k.
      </p>
      <p>
        If you're looking at larger developments, let's talk and see if it's a
        good fit as we are looking at growing to larger buildings.
      </p>

      <h2 className="cacti-two-heading">
        <CactiTwo />
        Commercial Real Estate Partners
      </h2>
      <p>
        We are looking at doing smaller commercial builds as well, think
        Starbucks or Chipotle size buildings. These builds become great PR as
        they are low carbon and high efficiency builds.
      </p>

      <h2 className="cacti-three-heading">
        <CactiThree />
        Investing Money into Nopal
      </h2>
      <p>
        Let's talk! Hopefully you're read through our many FAQs but there is
        much we haven't shared publicly.
      </p>
      <p>
        While we currently have 2 revenue models in place with a 3rd one coming
        online soon, we have a couple others short listed in the backlog, namely
        prefab and warehousing.
      </p>
      <p>
        We retain an open mind and quick to experiment and try to see what works
        and what doesn't.
      </p>

      <h2 className="cacti-four-heading">
        <CactiFour />
        Investing Time into Nopal
      </h2>
      <p>
        We are looking for folks that are like minded, highly curious and
        willing to step up to elevate the business. We are always looking at
        ways of approaching our business differently to gain an advantage. We'd
        love to see what you can bring to the table!
      </p>

      <h2 className="cacti-five-heading">
        <CactiFive />
        Partnerships
      </h2>
      <p>
        Working with existing builders is another path we are exploring. Many
        builders are burnt out and find their job frustrating at best. Building
        should be something that is challenging and rewarding more than it is
        frustrating.
      </p>
      <p>
        Because we are already educating people about our build and setting
        expectations, often times that is all it takes to turn a picky client
        into someone who champions your work.
      </p>

      <p className="mt-8 z-10 relative">
        <Link
          to="/path#faq"
          className="font-hand text-xl inline-flex items-center gap-2 -ml-8"
        >
          <BackArrow />
          Back to the Path
        </Link>
      </p>
    </div>
  );
}
