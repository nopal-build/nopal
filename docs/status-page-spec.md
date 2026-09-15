# `status.nopal.build` — spec

Status: spec only, nothing built yet. Written alongside
`docs/marketing-app-split-plan.md` since the split is what makes "one
status page, several services" a real question worth answering
deliberately instead of just repurposing `webapp`'s old `/health` page
(that page is marketing content — a building-health-score explainer — and
has nothing to do with system status; pure name collision, not related to
this at all).

## Goal

A single, public, no-login page at `status.nopal.build` showing whether
Nopal is actually up, for two audiences:
- **Humans checking during an incident** ("is it just me?") — needs to be
  reachable even when everything else is down, so it can't live on the
  same infra it's reporting on.
- **Us**, as the first signal something's wrong, ideally before a human
  reports it — needs alerting, not just a passive page.

## What it monitors

One component per independently-deployable piece, matching the real
failure domains from `docs/marketing-app-split-plan.md`:

| Component | What "down" means | Signal source today |
|---|---|---|
| Marketing site (nopal.build) | Site unreachable / 5xx | `webapp`'s `/api/health` |
| App (o.nopal.build) | Login/Vault/Daily Log unreachable / 5xx | `fruits`'s `/api/health` |
| Database (SurrealDB) | Either app can't read/write | **Not exposed today** — see below |
| GraphLog processing | Jobs queued but not draining | **Not exposed today** — see below |
| File storage (S3/Vault uploads) | Uploads/downloads failing | Not exposed; likely skip initially (see "Out of scope") |

### Gap: today's `/api/health` is deliberately too dumb for this

`webapp`/`fruits`'s existing `/api/health` (see either route file's own
comment) is intentionally a bare `200 ok` with **no downstream checks** —
that's correct and should stay exactly as-is, since it's what Fly's
bluegreen deploy health check gates on, and a slow DB call there would
block deploys for the wrong reason.

A status page needs a **different, second endpoint** per app — something
like `GET /api/status` — that actually checks:
- DB connectivity (a trivial SurrealDB query, with a tight timeout).
- (App only) Redis connectivity (GraphLog's queue).
- (App only) Age of the oldest unprocessed GraphLog job, as a proxy for
  "is the worker actually draining the queue" — the worker itself has no
  HTTP listener at all (see `packages/worker/fly.toml`'s own comment: no
  `[http_service]`, nothing to health-check directly), so this is the
  only realistic way to detect "worker is stuck/crashed" from outside.

This is real, if small, implementation work on both `webapp` and `fruits`
— not just a status-page-side config change — and should be scoped as its
own follow-up before picking a monitoring tool, since the tool needs
something real to poll.

## Build vs. buy

Two real options, not a false choice — either is legitimate:

**Option A — third-party status/uptime SaaS** (e.g. Better Stack,
Instatus, OpenStatus (open-source, has a hosted tier too), UptimeRobot).
Points it at the `/api/status` endpoints above (plus a synthetic "load
nopal.build homepage" / "load o.nopal.build/login" check for true outside-
in reachability, not just "the process is up"). Gets you, with near-zero
build time: public page + custom domain, historical uptime %, incident
timeline with updates, email/SMS/Slack alerting, subscriber notifications.
**Recommended starting point** — this is genuinely undifferentiated
infra, not part of what makes Nopal itself valuable, and every option
listed has a free or near-free tier at this scale (two services, low
request volume).

**Option B — self-hosted**, as its own small service (same pattern as
`webapp`/`fruits`/`worker` — its own Fly app, `status.nopal.build`
custom domain) that polls both `/api/status` endpoints on a schedule,
stores results + incident history in SurrealDB (a new `status_checks`/
`incidents` table, same DB the rest of the stack already uses), and
renders a page from that. More control (no third-party data-sharing, no
per-check-frequency pricing tier), more ongoing maintenance (alerting,
uptime-% computation, incident-management UI all become code you own).
Worth it later if a real reason to leave a SaaS shows up (cost at scale,
wanting the check logic to live next to the rest of the app's data model)
— not the recommended starting point given the actual size of this
product today.

Either way: **the status page's own hosting must not depend on Nopal's
own infra being up** — if it's self-hosted, it needs a genuinely separate
Fly app/region (or provider entirely) from `webapp`/`fruits`/`db`, so a
SurrealDB outage doesn't ALSO take down the page reporting the SurrealDB
outage. This is the one hard requirement regardless of which option is
chosen.

## Page content (either option)

- Overall status banner (All Systems Operational / Degraded / Outage —
  standard three/four-state pattern most status-page tools already give
  you for free).
- Per-component current status (table above).
- Uptime percentage per component, trailing 90 days (industry-standard
  window).
- Incident history: what happened, when, root cause once known, marked
  resolved — this is the part worth writing even during Phase 0 of
  actually adopting either option, since "we had an incident but nowhere
  public to log it" is worse than a slightly bare-bones page.
- Optional, not launch-blocking: email/webhook subscribe-to-updates.

## DNS / infra note

`status.nopal.build` is a new DNS record regardless of which option is
picked — a third-party SaaS (Option A) typically wants a `CNAME` handed
to their platform; a self-hosted page (Option B) is just another Fly app
custom domain, same pattern as `o.nopal.build` in
`docs/marketing-app-split-plan.md`'s Phase 7.

## Out of scope for v1

- Per-region latency breakdowns (single-region Fly deploy today per
  `primary_region = 'lax'` in every `fly.toml` — nothing to break down).
- S3/file-storage as its own monitored component — failures there mostly
  surface as the app's own `/api/status` DB/general check failing anyway
  (uploads go through the app, not directly to end users), so a
  dedicated check is low-value until proven otherwise.
- Anything worker-side beyond the queue-age proxy above — real per-stage
  GraphLog observability already exists for signed-in Admins/Supers at
  `/maker/graphlog` (see the `graphlog` skill); this page is about "is
  Nopal up," not a GraphLog ops dashboard.

## Suggested next steps

1. Decide Option A vs. B (recommend A to start).
2. Build `/api/status` on both `webapp` and `fruits` (the one real
   prerequisite regardless of option).
3. If Option A: sign up, point it at both `/api/status` endpoints + two
   synthetic browser checks, wire up `status.nopal.build`'s DNS, write the
   first incident-history entries by hand if there's backlog worth
   recording.
4. If Option B: scope it properly as its own small phased plan (data
   model, polling scheduler, page, alerting) — deliberately not detailed
   further here until Option A vs. B is actually decided.
