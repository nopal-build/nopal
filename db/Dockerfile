FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
# Pinned to an exact patch — NOT the floating `v3` tag. `v3` silently
# re-resolves to whatever the latest 3.x patch is at build time, so two
# otherwise-identical deploys (or a rebuild that re-pulls this base image)
# can end up running different `surreal` binaries against the SAME
# surrealkv volume. SurrealDB's on-disk "revision" format for catalog
# records (e.g. `TableDefinition`) only ever grows forward within a major
# version — a newer binary can upgrade older data in place, but an OLDER
# binary cannot read a revision a newer one already wrote. That skew is
# exactly what caused prod's
#   "Error resuming stalled index builds: ... Invalid revision `4` for
#   type `TableDefinition`"
# (3.1.6 added new fields to the table catalog record to support resuming
# orphaned concurrent index builds; a pre-3.1.6 binary ran against data a
# ≥3.1.6 binary had already written).
#
# To upgrade: bump this tag deliberately (keep it in sync with
# docker-compose.yml's `db` service), read the release's "Breaking
# changes"/on-disk-format notes at https://surrealdb.com/releases, and
# test on staging before prod. Never roll back to an older tag once a
# newer one has run against prod's volume.
COPY --from=surrealdb/surrealdb:v3.3.0 /surreal /surreal
COPY migrate.sh /migrate.sh
COPY start.sh /start.sh
COPY migrations/ /migrations/
EXPOSE 8080
CMD ["/bin/sh", "/start.sh"]
