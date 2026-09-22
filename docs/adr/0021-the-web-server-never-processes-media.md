# ADR-021 — The web server never processes media.

**Status:** Accepted, 2026-09-22

**Context.** The file folders round gave every photo a browser-sized rendition and every video a poster. The first build made them on the request path in the app (`fruits`), following the one precedent in the codebase, the public-folder thumbnail route, because a photo on a fresh daily note should have a thumbnail before any pipeline run. Nobody had weighed what a phone's photo costs to decode: a HEIC is decoded in WebAssembly, each decode holds about 130 MB the module never returns, and a new daily note asks for every thumbnail at once. Five phone photos took the 1 GB app process from 200 MB to 900 MB; Fly killed it and answered 502 to whoever was opening a note. The worker already decodes every one of those photos to describe it, has ffmpeg, and is the process that is allowed to spend that memory.

**Decision.** The fruits web server never decodes, resizes, frames or transcodes media. Every derived media file (a rendition, a poster, a frame) is made in `packages/worker`, either as a `renditions` job the upload route enqueues (`mediaQueue.server.ts`) or as sync-knowledge's backfill from the decode it already makes, and is stored in S3 under `renditions/<sha of the source's s3_key>/` (`mediaKeys.ts`). An app route may check that a rendition exists and redirect to it, or redirect to the original; it may not make one. The worker makes them one at a time, because a burst of uploads can do to the worker what a page did to the app. A photo that arrives shows as its original for the seconds until the worker's job runs, which is what it showed before renditions existed.

**Why it looks removable.** Making a thumbnail on demand is a few lines with `sharp`, it works on every JPEG in development, and it means a fresh upload has a thumbnail in the same request. The queue, the worker case and the redirect look like ceremony for a resize.

**How you'd know.** A 502 on a page full of photos, with the deploy green and the health check answering. The app's memory graph climbing on page views rather than on runs. A `sharp`, `heic-convert` or `ffmpeg-static` import reaching `fruits/app`.

**Test.** `fruits/app/tests/noMediaProcessingInApp.test.ts`: no file under `fruits/app` imports a decoder or calls a decoding function. The one allow-listed file is `api.vault.public-thumb.$fileId.tsx`, the older public-folder thumbnail route that predates this decision and is to be moved onto the same worker path; the allow-list shrinks to nothing when it is.
