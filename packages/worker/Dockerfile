# syntax = docker/dockerfile:1
#
# Build context is the REPO ROOT, not this directory — see webapp/Dockerfile's
# own note. Deploy with (run from the repo root):
#
#   fly deploy . --config packages/worker/fly.toml --dockerfile packages/worker/Dockerfile
#
# (`make deploy` does this for you.)
#
# The whole point of this being its OWN package (see the `phylog` skill's
# "Scaling & Process Isolation" section) is `pnpm --filter worker deploy
# --prod`, below — it produces a standalone `node_modules` containing ONLY
# what the PhyLog pipeline actually needs (bullmq, the Anthropic/AWS SDKs,
# surrealdb, a few small markdown-parsing packages), not React/MDXEditor/
# PDFKit/Express/etc — those never appear in this image at all.

ARG NODE_VERSION=22.23.2
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="PhyLog Worker"

WORKDIR /app

ENV NODE_ENV="production"

FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

RUN corepack enable pnpm

COPY --link pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --link packages/oxmarkdown-core/package.json packages/oxmarkdown-core/
COPY --link packages/robustness-core/package.json packages/robustness-core/
COPY --link packages/worker/package.json packages/worker/
COPY --link webapp/package.json webapp/
RUN pnpm install --frozen-lockfile

COPY --link packages/oxmarkdown-core packages/oxmarkdown-core
COPY --link packages/robustness-core packages/robustness-core
COPY --link packages/worker packages/worker

RUN pnpm --filter worker deploy --prod /app/deploy

FROM base

COPY --from=build /app/deploy /app

CMD [ "npm", "run", "start" ]
