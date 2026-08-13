# syntax = docker/dockerfile:1
#
# Build context is the REPO ROOT, not this directory — webapp is a pnpm
# workspace member that depends on the `robustness-core`/`oxmarkdown-core`
# packages (see the `phylog` skill's "Scaling & Process Isolation"
# section), so the build needs to see the whole workspace, not just
# `webapp/`. Deploy with (run from the repo root):
#
#   fly deploy . --config webapp/fly.toml --dockerfile webapp/Dockerfile
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
COPY --link packages/worker/package.json packages/worker/
COPY --link webapp/package.json webapp/
RUN pnpm install --frozen-lockfile

COPY --link packages/oxmarkdown-core packages/oxmarkdown-core
COPY --link packages/robustness-core packages/robustness-core
COPY --link webapp webapp

# Build the web app, then produce a standalone, pruned (`--prod`) deploy of
# JUST the `remix` (webapp) package + its real dependency graph — this is
# what actually ships, not the whole monorepo's node_modules.
RUN pnpm --filter remix run build
RUN pnpm --filter remix deploy --prod /app/deploy

# Final stage for app image
FROM base

COPY --from=build /app/deploy /app

EXPOSE 3000
CMD [ "npm", "run", "start" ]
