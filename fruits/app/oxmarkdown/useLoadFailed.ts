/**
 * Whether a picture failed to load, so the page can draw the file as a
 * file instead of the browser's broken-image icon (Austin, 2026-10-01:
 * "broken photo links anywhere in the software is a frustrating thing").
 *
 * The causes are fixed where they are found (who may open what is
 * `featureAccess.server.ts`). This is for what is left: a file deleted
 * since the words about it were written, a poster the worker has not made
 * yet, a format this browser cannot draw, a dropped connection.
 */
import { useCallback, useState } from "react";

export function useLoadFailed(src: string | undefined) {
  // The picture that failed, not a yes or no: a new `src` is a new chance
  // without anything to reset.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // A server-rendered `<img>` can fail before React is listening, and that
  // error is never replayed: a finished load with no pixels is the same
  // news. (A lazy image that has not started is not `complete`.)
  const ref = useCallback(
    (el: HTMLImageElement | null) => {
      if (src && el && el.complete && el.naturalWidth === 0) setFailedSrc(src);
    },
    [src],
  );
  return { failed: !!src && failedSrc === src, ref, onError: () => setFailedSrc(src ?? null) };
}
