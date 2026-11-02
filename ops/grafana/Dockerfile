# ─────────────────────────────────────────────────────────────────────────────
# Grafana — fly.io build
#
# Runs as root so the container can write to the fly volume (/var/lib/grafana),
# which is root-owned on first mount. No custom entrypoint needed — the
# parent image's /run.sh works fine as root. Mirrors
# savage/services/grafana's Dockerfile, which this was copied from.
#
# Server binding (0.0.0.0:3000) and paths are set explicitly in grafana.ini
# rather than relying on GF_SERVER_* env var parsing, which is fragile across
# Grafana image versions.
# ─────────────────────────────────────────────────────────────────────────────
FROM grafana/grafana:latest

USER root

# Ensure log directory exists (not part of the fly volume).
RUN mkdir -p /var/log/grafana

COPY grafana.ini      /etc/grafana/grafana.ini
COPY provisioning     /etc/grafana/provisioning
