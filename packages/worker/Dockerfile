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
COPY --link packages/stamps/package.json packages/stamps/
COPY --link packages/worker/package.json packages/worker/
COPY --link webapp/package.json webapp/
COPY --link fruits/package.json fruits/
RUN pnpm install --frozen-lockfile

COPY --link packages/oxmarkdown-core packages/oxmarkdown-core
COPY --link packages/robustness-core packages/robustness-core
COPY --link packages/worker packages/worker

RUN pnpm --filter worker deploy --prod /app/deploy

# ── heic-decode (Rust) ────────────────────────────────────────────────────────
# Built on plain Ubuntu 24.04 ("noble") to match the final stage's own
# OS exactly (`mcr.microsoft.com/playwright:v1.62.1-noble`) -- a
# dynamically linked binary built on a different base (this file's own
# Debian bookworm build stage above) risks a subtly incompatible
# glibc/libheif ABI at runtime. This stage's own size never reaches the
# final image -- multi-stage builds discard everything not explicitly
# COPY'd out of an earlier stage (see the `rust-heic-decode-worker`
# garden seed for the full HEIC-decode investigation this replaces).
FROM ubuntu:24.04 AS rust-build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl build-essential pkg-config zlib1g-dev libheif-dev libheif-plugin-libde265 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app
# `crates/heic-decode` is a standalone crate (its own Cargo.lock, not a
# member of the sibling `crates/` workspace -- see its own Cargo.toml) --
# specifically so this COPY never needs the other crates (`cli`/`api`/
# `app`/`core`) at all, and this image never installs THEIR system deps
# (`tonic-build`'s protobuf compiler, `eframe`/`rfd`'s GUI libraries) just
# to satisfy Cargo's workspace resolution.
COPY --link crates/heic-decode crates/heic-decode
RUN cd crates/heic-decode && cargo build --release

# The final stage is Playwright's own image at the lockfile's version
# (`playwright-core` in `package.json` must match this tag): Node 22 plus
# Chromium and its libraries, for the letter PDF
# (`letterPdfRender.server.ts`). The build stage above stays on
# node-slim; only the runtime needs a browser.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

ENV NODE_ENV="production"
# glibc gives each thread its own memory arena and rarely hands freed
# memory back; sharp's libvips threads made the worker's memory climb
# with every photo (30 photos: 531 MB, peak 639) until a GraphLog run on
# a seeded project ran the 1 GB machine out (2026-10-30). Two arenas: 298
# MB, peak 376, same work. sharp's own docs give this for glibc.
ENV MALLOC_ARENA_MAX="2"

# heic-decode's own runtime half: the shared libraries the compiled
# binary above links against dynamically -- `libheif-dev` in the
# `rust-build` stage is BUILD-time only (headers); this image needs the
# actual `.so` files plus the real HEVC decoder plugin, which Ubuntu
# keeps as a separate, not-installed-by-default package (see the
# `rust-heic-decode-worker` garden seed for why).
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y libheif1 libheif-plugin-libde265 && \
    rm -rf /var/lib/apt/lists/*

COPY --from=rust-build /app/crates/heic-decode/target/release/heic-decode /usr/local/bin/heic-decode
ENV HEIC_DECODE_BIN="/usr/local/bin/heic-decode"

COPY --from=build /app/deploy /app

CMD [ "npm", "run", "start" ]
