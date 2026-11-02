#!/usr/bin/env bash
# One-off (re-runnable) benchmark comparing the old WASM `heic-convert`
# path against the new native `heic-decode` Rust binary on real HEIC
# files. Not wired into CI -- a manual tool for exactly this kind of
# before/after question. Requires:
#   - `heic-convert` installed in a scratch dir (OLD_DECODE_DIR below);
#     it's deliberately NOT a repo dependency anymore (removed
#     2026-11-02), so point this at wherever you `npm install
#     heic-convert@2.1.0` for the comparison.
#   - `cargo build -p heic-decode --release` already run.
#   - `/usr/bin/time -l` (macOS) or `/usr/bin/time -v` (Linux, GNU time)
#     for peak RSS; this script assumes macOS's `-l` output shape.
set -euo pipefail

OLD_DECODE_DIR="${OLD_DECODE_DIR:-/tmp/heic-bench}"
NEW_BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/../target/release" && pwd)/heic-decode"

if [[ ! -f "$OLD_DECODE_DIR/old-decode.js" ]]; then
  echo "Expected $OLD_DECODE_DIR/old-decode.js (a copy of the pre-2026-11-02 HEIC_CHILD_SCRIPT, requiring ./node_modules/heic-convert) -- set OLD_DECODE_DIR or create it." >&2
  exit 1
fi
if [[ ! -x "$NEW_BIN" ]]; then
  echo "Expected a release build at $NEW_BIN -- run: cargo build -p heic-decode --release" >&2
  exit 1
fi

run_one() {
  local label="$1" cmd_description="$2"
  shift 2
  local tmpfile
  tmpfile=$(mktemp)
  local timing
  timing=$( { /usr/bin/time -l "$@" > "$tmpfile"; } 2>&1 1>/dev/null )
  local real_s maxrss_bytes
  real_s=$(echo "$timing" | awk '/real/ {print $1}')
  maxrss_bytes=$(echo "$timing" | awk '/maximum resident set size/ {print $1}')
  local out_size
  out_size=$(wc -c < "$tmpfile" | tr -d ' ')
  printf "%-10s %-30s %8s s  %10.1f MB  (output %s bytes)\n" "$label" "$cmd_description" "$real_s" "$(echo "$maxrss_bytes / 1048576" | bc -l)" "$out_size"
  rm -f "$tmpfile"
}

for photo in "$@"; do
  name=$(basename "$photo")
  size=$(wc -c < "$photo" | tr -d ' ')
  echo "=== $name ($size bytes input) ==="
  run_one "old (WASM)" "$name" node "$OLD_DECODE_DIR/old-decode.js" < "$photo"
  run_one "new (Rust)" "$name" "$NEW_BIN" < "$photo"
  echo
done
