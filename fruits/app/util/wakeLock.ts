/**
 * Best-effort: keeps the screen awake for the duration of `task()`, via
 * the Screen Wake Lock API (Safari 16.4+, Chrome/Edge/Android WebView;
 * not Firefox as of this writing). A real-world repro on iPhone Safari:
 * uploading a large photo over a slow connection takes long enough that
 * the OS's own screen-lock timeout fires mid-upload, and once the screen
 * locks, Safari suspends the page enough that the in-flight request
 * reliably stalls or dies outright -- the only fix is keeping the screen
 * on for as long as the upload takes.
 *
 * Never throws and never blocks `task()` on a browser/context without the
 * API (an older Safari, Firefox, or a request refused for some reason,
 * e.g. battery saver) -- this is a nice-to-have that makes a real
 * difference on the one platform it's needed most, not a requirement for
 * uploads to work at all.
 */
export async function withScreenAwake<T>(task: () => Promise<T>): Promise<T> {
  let sentinel: WakeLockSentinel | undefined;

  const request = async () => {
    try {
      sentinel = await navigator.wakeLock?.request("screen");
    } catch {
      // Not supported, refused, or the document isn't visible right this
      // instant -- fine either way, `task()` still runs unprotected.
      sentinel = undefined;
    }
  };

  // The lock is released automatically the moment the page is hidden
  // (the spec's own rule, not something a caller can override) -- if the
  // page becomes visible again while `task()` is still running (a brief
  // app-switch and back, not a real screen lock), re-acquire it instead
  // of silently leaving the rest of the upload unprotected.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && !sentinel) void request();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  await request();
  try {
    return await task();
  } finally {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    await sentinel?.release().catch(() => {});
  }
}
