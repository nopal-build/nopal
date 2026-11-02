# nopal-grafana

Self-hosted Grafana OSS, deployed as its own Fly app, pointed at this Fly
org's managed Prometheus (`https://api.fly.io/prometheus/<org-slug>/`).

**Why not Fly's own managed Grafana (`fly-metrics.net`)?** It's Fly-administered
and deliberately restricted — no alerting, no Service Accounts, no public/
embeddable dashboards (confirmed via Fly's docs and community reports). This
app is a normal, fully-admin'd Grafana instance that happens to query the
same underlying Fly Prometheus data, so we get real alerting (with a native
Discord contact point) and full dashboard control.

Everything here is provisioning-as-code — data source, dashboards, alert
rules, and the Discord contact point are all plain files under
`provisioning/`, loaded automatically on container start. Don't hand-edit
things in the Grafana UI that are provisioned here; edit the file and
redeploy instead (dashboards are the one exception — `allowUiUpdates: true`
lets UI edits to the dashboard persist back to the JSON file).

## What's covered

- `provisioning/datasources/fly-prometheus.yaml` — the Fly Prometheus data
  source.
- `provisioning/alerting/rules.yaml` — starter alert rules: OOM kill,
  non-zero exit code, low available memory. These close a gap app-level code
  can't cover itself: a process that's OOM-killed dies before it can send
  its own Discord message. Add more rules here as needed (e.g. HTTP error
  rate, response-time spikes) — see the file's own comments for the schema.
- `provisioning/alerting/contact-points.yaml` + `notification-policies.yaml`
  — routes every alert to Discord via a native Discord contact point.
- `provisioning/dashboards/fly-overview.json` — a starter "Fly Infrastructure
  Overview" dashboard (instance up/down, memory, CPU, HTTP latency/error
  rate, volume usage, recent exit events), filterable by app via a
  `$app` template variable.

This is deliberately separate from the app-level `notifyDiscord` work (see
root README's "Monitoring and alerting" section) — that covers *logical*
failures a running process can catch (cron jobs, BullMQ job failures,
uncaught exceptions); this covers *infrastructure* failures where the
process doesn't get a chance to report on itself.

## Required secrets (`fly secrets set -a nopal-grafana ...`)

| Secret | What it's for | How to get it |
|---|---|---|
| `FLY_PROM_TOKEN` | Auth to Fly's Prometheus endpoint | `fly tokens create readonly -o personal` (org-scoped, read-only is enough) |
| `DISCORD_ALERT_WEBHOOK_URL` | The Discord contact point's webhook | Discord: Server Settings -> Integrations -> Webhooks -> New Webhook. Deliberately separate from the repo's CI-only `DISCORD_WEBHOOK_URL` (root README) so infra alerts can post to a different channel than deploy notices. |
| `GF_SECURITY_ADMIN_USER` | Grafana login username | Pick one |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana login password | Pick one |

All four are read directly by Grafana (the first two via `$ENV_VAR`
interpolation in the provisioning YAML, the last two are Grafana's own
built-in admin-bootstrap env vars) — nothing else needs to change if they're
rotated, just `fly secrets set` + the app restarts itself.

## Deploy

```bash
cd ops/grafana
fly deploy
```

First-time setup (app + volume don't exist yet):

```bash
cd ops/grafana
fly apps create nopal-grafana
fly volumes create grafana_data --region dfw --size 1 -a nopal-grafana
fly secrets set -a nopal-grafana \
  FLY_PROM_TOKEN=... \
  DISCORD_ALERT_WEBHOOK_URL=... \
  GF_SECURITY_ADMIN_USER=... \
  GF_SECURITY_ADMIN_PASSWORD=...
fly deploy
```
