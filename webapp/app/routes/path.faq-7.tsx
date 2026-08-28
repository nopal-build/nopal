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
        {">"} How does a Nopal build fair against fire?
      </h1>
      <p>
        In short, pretty darn well. While there’s no such thing as a fireproofed
        building, there are many ways to bias toward surviving a fire. Since
        this is an FAQ we will skip landscaping and focus on the building.
      </p>
      <p>Let’s take a quick walk.</p>
      <p>
        First, I’d like to say this one is hard to write. It has been a long
        time topic of conversation for us. Most commonly after a destructive
        fire, and then people stop the search. The current timing hurts, with
        the LA fires burning. For the same reason, this feels like a good time
        to share what we “know.”
      </p>
      <p>
        <AudioFormat />
      </p>

      <h2 className="cacti-one-heading">
        <CactiOne />
        Concrete, Steel and Glass is Not the Answer
      </h2>
      <p>
        We constantly hear touting of building out of “non-combustible”
        materials. While it’s true that concrete won’t burn, the rest of the
        house likely will. Large panes of glass will shatter and steel
        reinforced concrete will bend and fail with enough heat (although this
        applies more to larger buildings). There’s a chance (and there are
        examples) that your concrete and glass bunker with no landscaping and no
        insulation will be passed by when a fire shoots through.
      </p>
      <p>
        But then your house is a carbon bomb and contributing to the exact
        change that leans toward more fires in the future.
      </p>

      <h2 className="cacti-two-heading">
        <CactiTwo />
        Wildfires Burn Homes from the Inside Out
      </h2>
      <p>
        The most common path to a house burning in a wildfire is super hot air
        being pushed inside, igniting flammable things. If your house includes
        spray foam, that means a fire accelerant and toxic emissions.
      </p>
      <p>
        Step 1 is building airtight. This is an area where extreme is good and
        good enough isn’t. We recommend building to at least a 1ACH50 blower
        door. Our builds routinely hit 0.4 and tighter. Also key, this
        airtightness has to be reached with durable materials and strategies. No
        spray foam, sparing use of Aerobarrier and no “airtight drywall”
        approaches. You need that tested airtightness to last for the next
        century.
      </p>

      <h2 className="cacti-three-heading">
        <CactiThree />
        Protecting the Openings
      </h2>
      <p>
        Glass, especially large panes in steel frames, flexes and shatters under
        pressure. Moderate openings with sturdy frames and triple pane tempered
        glass (common in high performance homes) resist both letting heat in and
        cracking under pressure.
      </p>

      <h2 className="cacti-four-heading">
        <CactiFour />
        ignition resistant insulation
      </h2>
      <p>
        Insulation should sail past code requirements without any tricker (I’m
        looking at you again spray foam). That means sticking a blowtorch to the
        insulation should result in charring, not flames. And we don’t want to
        get there by adding toxic chemicals.
      </p>
      <p>
        Ironically, our best options here come from nature. Wood fiber
        insulation borrows from physics seen in Redwood trees and sheep’s wool
        is just amazing.
      </p>

      <h2 className="cacti-five-heading">
        <CactiFive />
        High Thermal Mass
      </h2>
      <p>
        Some magical insulations have a high resistance to heat moving through
        them (R value) AND a high resistance to changing temperature (thermal
        mass). This combo helps keep the interior temps down as the exterior
        heats.
      </p>

      <h2 className="cacti-six-heading">
        <CactiSix />
        Ember Resistant Cladding
      </h2>
      <p>
        Now that we have kept hot air and embers out of the interior we move
        outside. Here we have a similar mission to the insulation. Metal is one
        obvious choice, but many wood claddings are oddly resistant, like the
        trees they came from. We don’t have to turn to brutalist and high carbon
        materials like block and concrete to clad our homes.
      </p>

      <h2 className="cacti-six-heading">
        <CactiSix />
        System Approach
      </h2>
      <p>
        Like health and air quality, the right solutions are systems working
        together. Luckily, the systems that optimize for health, durability and
        low carbon are the same that work for fire resistance.
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
