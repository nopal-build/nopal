import { useEffect, useRef, useState } from "react";
import {
  STEEP_QUESTION,
  STEEP_SCALE,
  type SteepPosition,
} from "robustness-core/data/steepScale";
import { SlopeGauge } from "./stamps-candidates/SlopeGauge";
import { localDateString } from "./TodayLog";

/**
 * The Steep-o-meter: how steep this stretch of the project feels, about
 * one project, from one person, today. The look is `SlopeGauge`'s; this
 * supplies the scale and saves a tap to `/api/steep`, optimistically,
 * rolling back if the save fails. Tapping again replaces today's reading.
 * Nothing about a steep reading is an alarm, here or anywhere it shows.
 *
 * `mine` is the person's latest reading here; it shows as chosen only when
 * it is from their own today, which only the device knows, so it resolves
 * after mount.
 */
export function SteepGauge({
  projectFolderId,
  mine,
  caption = STEEP_QUESTION,
  size = "full",
}: {
  projectFolderId: string;
  mine: { position: SteepPosition; date: string } | null;
  caption?: string;
  size?: "full" | "compact";
}) {
  const [chosen, setChosen] = useState<SteepPosition | null>(null);
  const [failed, setFailed] = useState(false);

  // `mine` is only the starting point. Once the person taps, their tap
  // wins: a revalidation (every log autosave on `/` causes one) can bring
  // back a `mine` from before the tap was stored.
  const tapped = useRef(false);
  useEffect(() => {
    if (!tapped.current && mine && mine.date === localDateString()) setChosen(mine.position);
  }, [mine]);

  const tap = async (position: SteepPosition) => {
    tapped.current = true;
    const before = chosen;
    setChosen(position);
    setFailed(false);
    const res = await fetch("/api/steep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectFolderId, position, date: localDateString() }),
    }).catch(() => null);
    if (!res || !res.ok) {
      setChosen(before);
      setFailed(true);
    }
  };

  return (
    <SlopeGauge
      options={STEEP_SCALE}
      chosen={chosen}
      onChoose={tap}
      caption={caption}
      size={size}
      note={failed ? "That didn't save. Tap again?" : undefined}
      data-steep-meter={projectFolderId}
    />
  );
}
