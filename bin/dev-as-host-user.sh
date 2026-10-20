#!/bin/sh
# Entry for the webapp/fruits/worker dev containers (docker-compose.yml):
# fix ownership as root, then run the given command as the HOST user.
#
# Why: these containers bind-mount the whole repo, and running as root
# left root-owned files on the host (`fruits/.react-router/types`,
# `webapp/.react-router/types`) that host-side tooling then cannot
# replace: `vitest` dies with EACCES before any test, which also breaks
# `make deploy`'s test step. Running as the host user means every file a
# container writes into the repo is yours.
#
# The named volumes (node_modules, pnpm store) were created by root, so
# anything in them not owned by the host user is handed over first. A
# no-op after the first run, except for whatever a root `docker compose
# exec` wrote since. Only real mount points are touched, never a plain
# host directory that happens to match the glob.
#
# HOST_UID/HOST_GID come from the Makefile (`id -u`/`id -g`), defaulting
# to 1000:1000 for a bare `docker compose up`.
set -e

uid="${HOST_UID:-1000}"
gid="${HOST_GID:-1000}"

for dir in /pnpm-store /app/node_modules /app/*/node_modules /app/packages/*/node_modules; do
  [ -d "$dir" ] && mountpoint -q "$dir" || continue
  if [ -n "$(find "$dir" ! -user "$uid" -print -quit)" ]; then
    echo "dev-as-host-user: handing $dir to $uid:$gid"
    chown -R "$uid:$gid" "$dir"
  fi
done

# Files earlier root-run containers left in the repo itself.
for dir in /app/fruits/.react-router /app/webapp/.react-router; do
  [ -d "$dir" ] || continue
  if [ -n "$(find "$dir" ! -user "$uid" -print -quit)" ]; then
    echo "dev-as-host-user: handing $dir to $uid:$gid"
    chown -R "$uid:$gid" "$dir"
  fi
done

exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
