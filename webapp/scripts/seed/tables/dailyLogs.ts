import type { DailyLog } from "../../../app/data/dailyLog.server";
import type { SeedTable, SeedRecord } from "../index";

type DailyLogSeed = SeedRecord<DailyLog>;

export const dailyLogsSeed: SeedTable<DailyLog> = {
  table: "daily_logs",
  records: [],
  /**
  records: [
    // ── Gerald L (super_1) ─────────────────────────────────────────────────
    {
      id: "super_1_2026-04-17",
      humanId: "super_1",
      date: "2026-04-17",
      content: `## Morning

Spent the first half of the day finishing the daily log feature. The MDX editor is wired up and saving cleanly — autosave with a 1.5 s debounce, plus an immediate save on blur. Feels solid.

One thing I kept going back and forth on: should the log entries render as plain \`<pre>\` blocks or as proper markdown? Went with markdown in the end. The editor produces markdown, so it should display as markdown. Obvious in hindsight.

## Afternoon

Call with Austin about the Willow Street project. Framing is ahead of schedule which is rare and good. He flagged a potential issue with the window rough openings — the plans show 2×6 framing but the spec sheet for the Intus windows calls for a deeper buck. Need to loop in Lucas before they close up that wall.

**Follow-up:** Email Lucas the window spec sheet tonight.

## Misc

- Pushed the markdown rendering fix to main
- Updated the seed scripts to include daily log entries (meta, I know)
- Remembered I need to book flights for the Passive House conference in May`,
      createdAt: "2026-04-17T08:12:00.000Z",
      updatedAt: "2026-04-17T17:45:00.000Z",
    },
    {
      id: "super_1_2026-04-20",
      humanId: "super_1",
      date: "2026-04-20",
      content: `## Standup

Quick Monday check-in with the team. Everyone is heads-down. James is sorting out an insulation substitution on the Brittle job — the originally specified Rockwool batch got delayed at the port. He's got two alternatives, both meet the R-value, different vapor profiles. I trust him to make the call.

## Product

Pushed a fix for the file upload path on the daily log — S3 keys were missing the user prefix so uploads from different users could collide. Embarrassing bug, caught it before anyone noticed.

Also added the \`links\` export for \`project.css\` on the daily log route so markdown styles actually load. The entries were rendering as raw pre-formatted text before. Fixed now.

## Reading

Finished the chapter on embodied carbon accounting in *The New Carbon Architecture*. The upshot: operational carbon is where most of the industry focuses, but for a well-insulated house the embodied carbon in the structure can represent 50–80% of lifetime emissions. We should be tracking this per project. Added it to the backlog.`,
      createdAt: "2026-04-20T09:00:00.000Z",
      updatedAt: "2026-04-20T16:30:00.000Z",
    },
    {
      id: "super_1_2026-04-22",
      humanId: "super_1",
      date: "2026-04-22",
      content: `Short day — took the afternoon off for a dentist appointment and didn't come back.

In the morning: reviewed Cam's budget reconciliation for the Optimist build. Numbers look fine, one line item for "misc site prep" is vague and I asked him to break it out before we send the client update.

Also had a good conversation with Clara Optimist over the app's messaging feature. She's been using the daily log which is great to see. Her entry about the kitchen layout decision was thoughtful — she'd clearly been sitting with the tradeoffs. That's exactly what this tool is for.

**Tomorrow:**
- Close out the window buck issue with Lucas
- Review Harmony's finish selections doc
- Merge the notification branch`,
      createdAt: "2026-04-22T08:45:00.000Z",
      updatedAt: "2026-04-22T12:15:00.000Z",
    },

    // ── Austin T (admin_1) ─────────────────────────────────────────────────
    {
      id: "admin_1_2026-04-16",
      humanId: "admin_1",
      date: "2026-04-16",
      content: `Site visit on Willow Street this morning. Good progress overall.

**What I saw:**
- Slab is fully cured, looks clean — no visible cracking
- Lumber delivery arrived Tuesday, stacked and tarped correctly
- Crew has started laying out the first-floor walls

**Concerns:**
The site is muddier than I'd like after last week's rain. We're tracking dirt into the garage slab area. Put out some crushed gravel at the entry point as a temporary fix but we should address the drainage properly before the next pour.

Spoke with the framing crew lead (Marco). He's confident they'll be topped out by end of next week if weather holds. I told him we need the window openings double-checked against the spec sheet before they sheath — there was a note from Gerald about the Intus buck depth. Marco said he'd flag it.

Drove by the Optimist site on the way back. Exterior is fully sheathed, WRB going on now. Looking good.`,
      createdAt: "2026-04-16T07:30:00.000Z",
      updatedAt: "2026-04-16T14:00:00.000Z",
    },
    {
      id: "admin_1_2026-04-19",
      humanId: "admin_1",
      date: "2026-04-19",
      content: `## Willow Street — Framing Update

Walls are going up fast. First floor is framed and they started on the second floor deck today. The crew is working clean which I always appreciate — cut ends stacked, nails swept, materials not scattered.

The window rough opening issue got resolved. Lucas confirmed the buck needs to be 6¾" deep for the Intus triple-glaze units. Marco adjusted and re-framed one opening that was already cut — only about an hour of rework. Caught it at the right time.

## Schedule

If framing finishes Thursday as projected:
- WRB and window install: week of April 27
- Rough mechanicals start: May 4 (pending Lucas confirming his HVAC sub)
- Insulation: ~May 11

That would put us at blower door test around end of May. Optimistic but possible.

## Other

Ordered the structural connectors for the roof framing. Lead time is 5 days, should arrive in time.`,
      createdAt: "2026-04-19T08:00:00.000Z",
      updatedAt: "2026-04-19T15:45:00.000Z",
    },
    {
      id: "admin_1_2026-04-21",
      humanId: "admin_1",
      date: "2026-04-21",
      content: `Framing is topped out on Willow Street. Roof deck goes on tomorrow.

Had a longer conversation with Harmony Willow this afternoon — she stopped by the site unannounced which is totally fine, I just wish I'd known so I could have given her a proper walkthrough. She had good questions about the window placement in the living room and whether the south-facing glazing was going to cause overheating in summer. I explained the roof overhang calculation and the interior thermal mass strategy. She seemed reassured.

I should schedule a proper milestone walkthrough with her once the roof is on and dried in. She deserves a real tour, not a muddy hard-hat scramble.

**Action items:**
- Schedule Harmony walkthrough for week of April 28
- Confirm roof decking delivery for tomorrow morning (7am)
- Send Lucas framing completion notice so he can schedule rough-in`,
      createdAt: "2026-04-21T09:15:00.000Z",
      updatedAt: "2026-04-21T17:00:00.000Z",
    },

    // ── Lucas J (admin_2) ──────────────────────────────────────────────────
    {
      id: "admin_2_2026-04-17",
      humanId: "admin_2",
      date: "2026-04-17",
      content: `## HVAC Design — Willow Street

Finished the Manual J load calculation for Willow Street. Numbers came out well — the envelope is tight enough that the heating load is only 18,000 BTU/h for the whole house. That's about half what you'd see in a code-minimum build of the same size.

Going with a Mitsubishi Hyper Heat ducted system. Single air handler in the mechanical room, four zones. The ERV will be a Zehnder ComfoAir 200 — it's overkill for the square footage but the Willows specifically asked for the best IAQ we could deliver and the Zehnder is hard to beat on efficiency and filtration.

**Open question:** Do we run the ERV ducting independently or share the duct system with the HVAC? Shared is cheaper and simpler, but dedicated ERV ducting gives better control over distribution. Leaning toward dedicated. Will confirm with Gerald.

## Other

Called three mechanical subs for bids. Two called back. Third one (preferred, we've used them before) is on vacation until Monday. Will follow up then.`,
      createdAt: "2026-04-17T09:30:00.000Z",
      updatedAt: "2026-04-17T16:00:00.000Z",
    },
    {
      id: "admin_2_2026-04-21",
      humanId: "admin_2",
      date: "2026-04-21",
      content: `Got the third mechanical bid back. Going with Meridian HVAC — they've done Zehnder installs before and their price was competitive. Sent contract for review.

## Coordination

Austin sent notice that Willow Street framing is done. Scheduled rough-in start for May 5. That gives us two weeks to finalize duct layout and get materials on order. Comfortable timeline.

Also touched base with the insulation sub (James is handling the Brittle job, but the Willow Street insulation is mine to coordinate). Dense-pack cellulose in the walls, blown-in at the attic. Insulation sub is available the week of May 11. Good.

## Issue — Brittle Job

James flagged the Rockwool delay earlier this week. I had a look at the two alternatives he's considering:

1. **Knauf Earthwool** — similar vapor profile to Rockwool, slightly lower compressive strength, fine for this application
2. **Owens Corning 700 Series** — higher density, better sound attenuation, costs about 8% more

I'd go with Knauf if budget is tight, Owens Corning if the client can absorb the delta. Told James.`,
      createdAt: "2026-04-21T10:00:00.000Z",
      updatedAt: "2026-04-21T16:45:00.000Z",
    },

    // ── James W (admin_3) ──────────────────────────────────────────────────
    {
      id: "admin_3_2026-04-18",
      humanId: "admin_3",
      date: "2026-04-18",
      content: `Foundation inspection passed on the Brittle job. No issues flagged. The inspector made a comment about the radon mitigation stub-up — "don't usually see that on new builds around here" — in an approving way. Always satisfying when someone notices the details.

## Insulation Problem

Got a call from the supplier this afternoon: the Rockwool Safe'n'Sound order (600 sq ft, for the Brittle interior partition walls) is stuck at the Port of Seattle due to a container backlog. Estimated arrival: 2–3 weeks. That puts us past the drywall schedule.

Researching alternatives now. Two options that are locally stocked:
- Knauf Earthwool (Lucas also mentioned this)
- Owens Corning 700 Series

Going to price both out tonight and discuss with Susan Brittle tomorrow. She's particular about materials and will want to know about the substitution.

## End of Day

Left the site at 4pm. Crew is in good shape. No overtime needed this week.`,
      createdAt: "2026-04-18T07:45:00.000Z",
      updatedAt: "2026-04-18T16:30:00.000Z",
    },
    {
      id: "admin_3_2026-04-22",
      humanId: "admin_3",
      date: "2026-04-22",
      content: `## Insulation Decision

Talked to Susan Brittle about the Rockwool substitution. She was more flexible than I expected — mainly wanted confirmation that the acoustic performance would be equivalent. Owens Corning 700 Series has slightly better STC ratings than Rockwool Safe'n'Sound in that wall assembly, so it's actually an upgrade. Once I explained that, she was fine with it.

Ordered the Owens Corning this morning. Available for pickup Friday. Insulation crew starts Monday April 27 — no schedule impact.

## Other Notes

- Walked the mechanical rough-in with the plumber. Everything looks right. One pipe location conflicts with a structural header; plumber is rerouting, minor.
- Blower door is booked for May 28. That's the target.
- Susan asked again about the completion date. We said end of June. Still on track if nothing else slips.`,
      createdAt: "2026-04-22T08:00:00.000Z",
      updatedAt: "2026-04-22T15:30:00.000Z",
    },

    // ── Cam W (admin_4) ───────────────────────────────────────────────────
    {
      id: "admin_4_2026-04-16",
      humanId: "admin_4",
      date: "2026-04-16",
      content: `First real day on the Optimist project since the permit came through. Did a site orientation with the crew — went through material storage expectations, safety zones, sequencing.

**Site conditions:** Clean, relatively flat, access from the east side only. Neighbor on the west side has already introduced himself and is "watching closely." Flagged this to the team — be respectful, keep it tidy.

**Material deliveries this week:**
- Lumber: confirmed for Tuesday
- ZIP System sheathing: confirmed for Wednesday
- Concrete for footings: Thursday 7am

Felt good to be moving again after two weeks of permit purgatory. The Optimist family came by at the end of the day. Clara and her husband are excited — stood on the lot for 20 minutes just talking about where things would go. That energy is why I do this.`,
      createdAt: "2026-04-16T06:45:00.000Z",
      updatedAt: "2026-04-16T17:00:00.000Z",
    },
    {
      id: "admin_4_2026-04-19",
      humanId: "admin_4",
      date: "2026-04-19",
      content: `## Budget Reconciliation

Went through the Optimist project budget line by line. We're 4% under on framing labor (crew has been efficient) and 2% over on site prep due to unexpected rock that needed breaking up last week. Net position is slightly favorable. Good.

Sent Gerald a summary with the misc site prep line broken out as he requested. Three items: compactor rental, rock breaking sub, and crushed gravel for the entry path. All legitimate.

## Week Ahead

- WRB installation starts Monday — have the crew and materials ready
- Window delivery is scheduled Wednesday; Cam to be on site for offload
- Clara Optimist wants to come by Tuesday afternoon to see the framing — confirmed

## One Concern

The window delivery lead time was originally 6 weeks, then got extended to 8. We ordered at week 1, we're now at week 5. If there's another delay we start floating the schedule. I've been checking in with the supplier weekly. Will call again Monday.`,
      createdAt: "2026-04-19T09:00:00.000Z",
      updatedAt: "2026-04-19T15:00:00.000Z",
    },
    {
      id: "admin_4_2026-04-21",
      humanId: "admin_4",
      date: "2026-04-21",
      content: `Windows confirmed for Wednesday delivery. Relief.

Clara came by the site today as planned. She's great to work with — asks smart questions and doesn't second-guess every decision, just wants to understand the reasoning. We walked the framed first floor and talked through the kitchen layout.

She mentioned she'd been going back and forth on the kitchen island size in her daily log (didn't realize she was using that feature, nice). Her concern: a 48" island feels big for the space on paper, but once we walked it out with tape on the subfloor she was immediately more confident. Physical space is different from drawings. Always.

**WRB starts tomorrow.** Crew is ready, weather looks clear through Thursday. Good timing.`,
      createdAt: "2026-04-21T08:30:00.000Z",
      updatedAt: "2026-04-21T16:00:00.000Z",
    },
    {
      id: "admin_4_2026-04-22",
      humanId: "admin_4",
      date: "2026-04-22",
      content: `WRB is 60% on. Good pace. Crew should finish Thursday.

Short day for me — had a dentist appointment in the afternoon (Gerald and I apparently have the same dentist and the same scheduling habits).

One thing I want to document: we made a decision today to run the WRB up and over the top plate on the gable ends rather than stopping at the top of the sheathing. Adds maybe 30 minutes of labor but improves the continuity of the air barrier significantly. Small decisions like this compound over the whole building.

Sent the week-end status report to Gerald and the Optimist file.`,
      createdAt: "2026-04-22T07:00:00.000Z",
      updatedAt: "2026-04-22T12:45:00.000Z",
    },

    // ── Harmony Willow (human_1) ──────────────────────────────────────────
    {
      id: "human_1_2026-04-19",
      humanId: "human_1",
      date: "2026-04-19",
      content: `Stopped by the site today without calling ahead first, which I should probably stop doing — but Austin was there and was totally gracious about it. He walked me around and explained everything patiently.

The house is *real* now. Seeing the walls framed and standing, I could actually feel the scale of the rooms for the first time. The living room is going to be bigger than I imagined from the drawings. The bedroom feels cozy in a good way.

I asked Austin about the south windows and whether we'd overheat in summer. He explained the roof overhang is calculated to block the high summer sun while letting in the lower winter sun. I understood the concept from the design meetings but hearing it explained while standing in the framed room, looking up at where the overhang will be, made it click differently.

Starting to feel real. Really real.`,
      createdAt: "2026-04-19T18:00:00.000Z",
      updatedAt: "2026-04-19T18:30:00.000Z",
    },
    {
      id: "human_1_2026-04-22",
      humanId: "human_1",
      date: "2026-04-22",
      content: `Austin reached out to schedule a proper walkthrough for next week. Looking forward to it — I want to go through the space more methodically, not just a drop-in.

## Questions I want to ask

- What finishes are we still deciding on? I know we locked in the flooring but I think tile selections are still open.
- Is there a decision needed on the interior door hardware soon? I saw something in the spec sheet about a lead time.
- The mudroom built-ins — are those part of the contract or are we sourcing them separately?

## Other Thoughts

I've been reading about low-VOC paints and whether the brand we spec'd is actually as clean as marketed. Going to send Austin a note and ask if we can talk through it on the walkthrough.

This project is making me read a lot. I feel like I've learned more about construction in the last six months than in my whole life before.`,
      createdAt: "2026-04-22T20:15:00.000Z",
      updatedAt: "2026-04-22T20:45:00.000Z",
    },

    // ── Clara Optimist (human_2) ──────────────────────────────────────────
    {
      id: "human_2_2026-04-17",
      humanId: "human_2",
      date: "2026-04-17",
      content: `## Kitchen Island

I've been going back and forth on the kitchen island size for two weeks now. The plan shows 48" × 96" which is what we asked for originally, but looking at the floor plan on paper it *looks* massive. I keep second-guessing it.

Arguments for keeping it at 48"×96":
- We specifically wanted seating for four on the island
- The kitchen is actually a large footprint, the drawing just flattens it
- Cam said the proportions work with the ceiling height

Arguments for going smaller (36"×84"):
- Less overwhelming on paper
- Slightly easier circulation path from the back door

I think I need to go to the site and tape it out. That's probably the only way to stop going in circles.

Emailing Cam to ask about a site visit.`,
      createdAt: "2026-04-17T21:00:00.000Z",
      updatedAt: "2026-04-17T21:20:00.000Z",
    },
    {
      id: "human_2_2026-04-20",
      humanId: "human_2",
      date: "2026-04-20",
      content: `Material samples arrived today — the flooring, the tile for the wet areas, and the countertop samples.

**White oak flooring (3" plank):** Beautiful. Warmer than I expected from the photo. Absolutely keeping this.

**Porcelain tile for bathrooms:** The large format (24×48) looks very sleek but I'm second-guessing it for the main bath floor. It feels a bit cold. The smaller hexagon mosaic we had as a backup option might be better there, even if it's slightly more labor to install. Will ask about cost difference.

**Quartzite countertops:** The Calacatta Alto sample is stunning but it's $30/sqft more than the Silestone we originally budgeted. Need to decide if the kitchen is where I want to spend that delta or if it goes somewhere else.

Good problem to have. We've been very lucky with this build so far.`,
      createdAt: "2026-04-20T17:30:00.000Z",
      updatedAt: "2026-04-20T18:00:00.000Z",
    },
    {
      id: "human_2_2026-04-21",
      humanId: "human_2",
      date: "2026-04-21",
      content: `Went to the site with Cam today. He taped out the kitchen island on the subfloor.

The 48"×96" island is **completely fine**. I don't know what I was worried about. Standing in the actual space with the framing around me, the proportions are obviously right. The drawings make rooms look smaller than they are, especially when you're zoomed in and comparing measurements to a coffee table or something.

Cam was patient about it and said clients do this with kitchen islands all the time. I believe him.

**Decisions made today:**
- Island stays at 48"×96" ✓
- We're doing the hexagon tile in the main bath, not large format
- Confirmed window placement, no changes

Still undecided on countertops. Cam said I have until May 1 before it affects the schedule.`,
      createdAt: "2026-04-21T19:45:00.000Z",
      updatedAt: "2026-04-21T20:15:00.000Z",
    },

    // ── Susan Brittle (human_3) ───────────────────────────────────────────
    {
      id: "human_3_2026-04-16",
      humanId: "human_3",
      date: "2026-04-16",
      content: `The inspection passed which is good news. James texted me a photo of the inspector signing off. I appreciated that.

But I'm getting anxious about the timeline. We were told "end of June" for move-in and I know that's always approximate in construction, but we've given notice on our rental for July 1 and there's not a lot of wiggle room. I asked James directly today: are we on track?

He said yes, no red flags, and walked me through the remaining schedule. It was reassuring to hear it laid out step by step. I just wish I got that kind of update proactively rather than having to ask.

I'm going to try to log things here more regularly. Helps me process and gives me a record if I ever need to look back at what was said and when.`,
      createdAt: "2026-04-16T19:00:00.000Z",
      updatedAt: "2026-04-16T19:20:00.000Z",
    },
    {
      id: "human_3_2026-04-21",
      humanId: "human_3",
      date: "2026-04-21",
      content: `James called today to tell me about the Rockwool insulation substitution. I'll be honest — my first reaction was frustration. We spent a lot of time in the design process selecting specific materials and I don't love being told after the fact that something is being swapped out.

But James explained it well. The Owens Corning 700 Series has *better* acoustic performance than what we originally specified, and the reason for the switch is a supply delay outside anyone's control. He was transparent about it, gave me the data sheet, and offered to get on a call if I had questions. That's the right way to handle it.

I said yes to the substitution.

What I want to document for myself: this project is going well. James is competent and communicates honestly. My anxiety about the timeline is real but it's mostly coming from the rental situation, not anything the team has actually done wrong. I should try to separate those two things.

Still want proactive updates. Going to ask for a weekly check-in.`,
      createdAt: "2026-04-21T20:30:00.000Z",
      updatedAt: "2026-04-21T21:00:00.000Z",
    },
  ] satisfies DailyLogSeed[],
 */
};
