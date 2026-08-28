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
      <h1 className="italic">{">"} What are Atomic Teams?</h1>
      <p>
        Atomic Teams is our take on a bottom up, empowering approach to
        returning to the craft-built buildings of our past....but with comfort
        and function that feels like it must be from the future.
      </p>
      <p>
        <AudioFormat />
      </p>

      <h2 className="cacti-one-heading">
        <CactiOne />
        What's wrong with what we have?
      </h2>
      <p>
        The construction industry suffers from an endemic top down approach.
        There is an assumption that those at the top know how to do something
        best. The search for ever-cheaper builds has led to low-quality
        materials, unskilled labor, high turnover and tightly defined scopes of
        work in an attempt to keep quality up.
      </p>
      <p>
        But building a building isn't like canning carrots in a factory. Our
        industry needs a revolution akin to what Toyota brought to auto
        manufacturing decades ago.
      </p>

      <h2 className="cacti-two-heading">
        <CactiTwo />
        Means {"&"} Methods
      </h2>
      <p>
        The ideal solutions here are bottom up. Those in charge of the work are
        in charge of how the work gets done. Our industry currently tries this
        with "means and methods." Each trade is allowed to perform the finer
        details of their work how they see fit. This is to limit the liability
        of those further up the top-down chain. The result is more silos and
        less shared knowledge. This works OK for just-get-it-done low-cost
        projects, but what happens when those means and methods are in direct
        conflict with the higher goals of a project?
      </p>

      <h2 className="cacti-three-heading">
        <CactiThree />
        Bring in the Guides
      </h2>
      <p>
        The top down focused team brings in various consultants who specialize
        in certain goals. We know this role well when those goals are
        durability, health, comfort or low carbon. This approach can work. We
        have daily wins educating each trade. We see poor materials permanently
        dropped for better ones. Outcomes can improve.
      </p>
      <p>
        But it's slow, costly and the durability of results can take constant
        effort.
      </p>

      <h2 className="cacti-four-heading">
        <CactiFour />
        Flip It Over
      </h2>
      <p>
        What if these trades could evolve into craftspeople? What if the deep
        dives were completed, the guardrails set, the system in place and these
        teams could show up daily to do what they love, get work done.....with
        style.
      </p>

      <h2 className="cacti-five-heading">
        <CactiFive />
        Atomic Teams
      </h2>
      <p>
        We call our solution Atomic Teams. These are two-person teams working
        together to build most of a building. Tightly defined systems limit
        wasted thought, rework and confusion while enabling these people to
        tackle the work of at least ten trades with increased efficiency.
      </p>
      <p>
        By limiting side distractions, we encourage these teams to bring their
        own fingerprint. Specific details can be done with variation without
        affecting system performance. Each team develops their own tradecraft
        and contributes to Nopal institutional knowledge.
      </p>

      <h2 className="cacti-six-heading">
        <CactiSix />
        Support the Whole
      </h2>
      <p>
        This leads to cycles of learning. A culture of sharing becomes natural.
        Bottom up with support from above. A team climbing a mountain rather
        than surviving a corporation.
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
