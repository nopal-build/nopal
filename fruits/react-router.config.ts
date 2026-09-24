import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Opts out of "Lazy Route Discovery": with the default `lazy` mode, the
  // client fetches route metadata on demand from `/__manifest`, tagged
  // with a build version hash. Any code change (dev: every save, prod:
  // every deploy) changes that hash server-side, so the next navigation
  // to an undiscovered route (e.g. any AppLayout nav link outside the
  // current page's ancestry) sees a version mismatch and forces a hard
  // `window.location` reload to resync -- which is what was showing up
  // as an unexpected redirect. `initial` loads every route's metadata
  // upfront instead, so there's nothing to go stale at runtime.
  routeDiscovery: { mode: "initial" },
} satisfies Config;
