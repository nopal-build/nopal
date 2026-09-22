# syntax = docker/dockerfile:1
#
# Build context is the REPO ROOT, not this directory — fruits is a pnpm
# workspace member that depends on the `robustness-core`/`oxmarkdown-core`/
# `stamps` packages (see docs/marketing-app-split-plan.md), so the build
# needs to see the whole workspace, not just `fruits/`. Deploy with (run
# from the repo root):
#
#   fly deploy . --config fruits/fly.toml --dockerfile fruits/Dockerfile
#
# (`make deploy` does this for you.)

ARG NODE_VERSION=22.23.2
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="React Router"

WORKDIR /app

ENV NODE_ENV="production"

# Throw-away build stage to reduce size of final image
FROM base AS build

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

RUN corepack enable pnpm

# Copy the whole workspace — every package's package.json first (better
# layer caching), then source.
COPY --link pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --link packages/oxmarkdown-core/package.json packages/oxmarkdown-core/
COPY --link packages/robustness-core/package.json packages/robustness-core/
COPY --link packages/stamps/package.json packages/stamps/
COPY --link packages/worker/package.json packages/worker/
COPY --link webapp/package.json webapp/
COPY --link fruits/package.json fruits/
RUN pnpm install --frozen-lockfile

COPY --link packages/oxmarkdown-core packages/oxmarkdown-core
COPY --link packages/robustness-core packages/robustness-core
COPY --link packages/stamps packages/stamps
COPY --link fruits fruits

# Build the app, then produce a standalone, pruned (`--prod`) deploy of
# JUST the `fruits` package + its real dependency graph — this is what
# actually ships, not the whole monorepo's node_modules.
RUN pnpm --filter fruits run build

# The built server bundle must at least LOAD under the same Node that will
# run it. Vite's SSR build can inline a CommonJS dependency into an ES
# module (it did with `ffmpeg-static` on 2026-09-22: `__dirname` in ESM,
# ERR_AMBIGUOUS_MODULE_SYNTAX at boot, a Fly machine that never passed its
# health check, and nothing before the deploy to say so). Importing the
# bundle here evaluates every module's top level and nothing else: the
# database connection and the S3 client are lazy, so no service is needed.
RUN cd fruits && node --input-type=module -e "await import('./build/server/index.js'); console.log('server bundle loads');"

RUN pnpm --filter fruits deploy --prod /app/deploy

# Final stage for app image
FROM base

COPY --from=build /app/deploy /app

EXPOSE 3000
CMD [ "npm", "run", "start" ]
