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
      <h1 className="italic">
        {">"} What about Community {"&"} Curiosity?
      </h1>
      <p>
        Building homes use to take a community, this is why we want to help
        build communities. To do this we do what nature has naturally provided
        us, a spark of curiosity.
      </p>
      <p>
        We don't believe to have all the answers, but by continuing to keep open
        minds and change as we learn we can work towards a better or more
        complete understanding.
      </p>
      <p>
        <AudioFormat />
      </p>

      <h2 className="cacti-one-heading">
        <CactiOne />
        Curious Classes
      </h2>
      <p>
        One of our objectives is to hold classes to help everyone understand the
        theory about how healthy buildings work. This lays the foundation for
        the practical or hands on skills.
      </p>
      <p>
        Think of this as an art class, you first learn all the rules, that way
        you know how and when you can break them.
      </p>
      <p>
        Art doesn't have a perfect answer and neither does a building. There are
        always trade-offs we need to make in order to build. Teaching this
        requires dedication and patience so for the few that find themselves
        interested in learning we want to provide the opportunity.
      </p>

      <h2 className="cacti-two-heading">
        <CactiTwo />
        Curious Play
      </h2>
      <p>
        Because of our Atomic teams, they each are going to have their own
        personality and we encourage this. Building should be an inspiring
        process and when that happens you naturally see creativity shine.
      </p>
      <p>
        If our goal is to build just to make money, we lose out on so much of
        what life has to offer, especially when it comes to community.
      </p>

      <h2 className="cacti-three-heading">
        <CactiThree />
        Curious Craft
      </h2>
      <p>
        Learning skills is part of building, and there are no shortage of skills
        one can pick up. Because our builds require fewer people, there is more
        opportunity for the buyer to decide what they want to take on or what
        they would prefer to have others take on.
      </p>
      <p>
        This means that they can learn best by focusing on the parts they are
        interested in, but have the support behind them to ensure they are
        tackling it properly.
      </p>

      <h2 className="cacti-four-heading">
        <CactiFour />
        Curious Groups
      </h2>
      <p>
        We keep our learning groups small to help build relationships while
        learning. Relationships are important for support and for motivation.
      </p>
      <p>
        We can guarantee that if you join our community, you'll be Curious
        Certified for sure.
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
