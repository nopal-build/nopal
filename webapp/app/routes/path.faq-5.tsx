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
import { Annotation } from "../components/Annotation";

export default function PathFaqFour() {
  return (
    <div className="pt-16 uncooked-markdown">
      <h1 className="italic">{">"} How quickly can we scale?</h1>
      <p>
        <i>
          To better understand this make sure you review the{" "}
          <Link to="/path/faq-2">baselayer</Link>,{" "}
          <Link to="/path/faq-3">atomic teams</Link> and{" "}
          <Link to="/path/faq-4">a curious community</Link>.
        </i>
      </p>
      <p>
        <AudioFormat />
      </p>

      <h2 className="cacti-one-heading">
        <CactiOne />
        Scaling our Baselayer
      </h2>
      <p>There are a few ways we are looking to scale our baselayer:</p>
      <ul>
        <li>Scale to different climates</li>
        <li>Scale size to accommodate larger buildings</li>
        <li>Scale to enable more designs</li>
      </ul>
      <p>
        With every build we do, we naturally grow the capabilities. However we
        can save money by by using the existing capabilities. This helps us
        reduce cost where it matters.
      </p>

      <h2 className="cacti-two-heading">
        <CactiTwo />
        Scaling Atomic Teams
      </h2>
      <p>
        We have multiple paths to growing the teams but a quick summary for this
        section is based on demand:
      </p>
      <ul>
        <li>3-5 teams in year one</li>
        <li>10+ teams every year after</li>
      </ul>

      <h3 className="cacti-three-heading">
        <CactiThree />
        Prefer Hiring Full Time
      </h3>
      <p>
        Because of our focus on knowledge and community, we prefer hiring
        full-time employees with full benefits including health insurance. This
        is how we grow communities, by first building long term trust with our
        employees.
      </p>
      <p>
        We will always hire contractors for electrical, plumbing or other
        specialty trades.
      </p>

      <h2 className="cacti-four-heading">
        <CactiFour />
        Contract to Hire
      </h2>
      <p>
        If funding isn't available, we may need to do a contract to hire
        approach until we stabilize demand. This allows us to practice training
        while continuing to grow.
      </p>

      <h3 className="cacti-five-heading">
        <CactiFive />
        Partner Atomic Teams
      </h3>
      <p>
        Want to run your own atomic team? Sure! You don't have to join Nopal to
        gain the benefits of using <Link to="/path/faq-2">our baselayer</Link>.
        We are in discussions with existing teams in other locations that are
        interested but need to retain the flexability of a traditional build
        company.
      </p>
      <p>
        Since our Atomic teams are bottom up, this enables people to still run
        their own business if they want.
      </p>

      <h3 className="cacti-six-heading">
        <CactiSix />
        Home Builders / DIY
      </h3>
      <p>
        Because our system is teachable, we'd also like to get a few home
        builders trying it out. These folks generally are highly curious with
        the capability to run an Atomic team. If they build their own ADU, they
        learn and train while saving money on their build.
      </p>
      <p>
        This is a great option to potentially pull people from other sectors
        into the construction industry.
      </p>

      <h3 className="cacti-six-heading">
        <CactiSix />
        Apprenticeships
      </h3>
      <p>
        Early on we won't be able to offer this, but in a year we should be able
        to start opening up spots to train others. This is a great way to scale
        the number of teams as well.
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
