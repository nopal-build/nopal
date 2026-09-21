#!/bin/sh
# Builds the CSR wasm bundle fresh (so these tests always exercise the
# CURRENT source, never a stale cached one left over from manual testing)
# and serves it on the port `playwright.config.ts` expects. A shell script
# rather than an inline `webServer.command` purely so this exact sequence
# is runnable standalone too, e.g. to debug why a build failed.
set -eu

cd "$(dirname "$0")/.."

cargo build -p oxmarkdown-editor --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/debug/oxmarkdown_editor.wasm \
  --out-dir crates/oxmarkdown-editor/web/pkg --target web --no-typescript

exec python3 -m http.server 4178 --directory crates/oxmarkdown-editor/web
