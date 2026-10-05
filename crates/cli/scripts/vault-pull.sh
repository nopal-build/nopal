#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# vault-pull.sh — recursively downloads a Vault folder tree into a local
# directory. A thin wrapper around the existing `nopal vault` commands
# (ls --json, download) — no new CLI primitive, just automates the walk a
# human would otherwise do by hand, folder by folder.
#
# Usage:
#   crates/cli/scripts/vault-pull.sh <vault-path> <local-dir>
#
# Example:
#   crates/cli/scripts/vault-pull.sh projects/garden ./garden-pulled
#
# Re-running overwrites local files with whatever's currently in the vault
# (a "pull latest", not a merge) — folders are matched by NAME, not id, so
# a folder renamed in the vault since the last pull shows up as a new,
# separate local directory rather than a rename.
#
# Requires `jq` to parse `nopal vault ls --json` output, and bash (for
# safe recursion + filenames containing spaces) — this is a developer-run
# utility, not part of the deploy pipeline, so neither dependency needs
# the minimal /bin/sh the rest of this repo's scripts target. Deliberately
# NOT using `mapfile`/`readarray` (bash 4+ only) since macOS ships bash
# 3.2 by default — the `while read < <(...)` pattern below works on both.
# =============================================================================

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not installed — try: brew install jq" >&2
  exit 1
fi
if ! command -v nopal >/dev/null 2>&1; then
  echo "nopal CLI not found on PATH — install it first." >&2
  exit 1
fi

VAULT_PATH="${1:-}"
LOCAL_DIR="${2:-}"

if [[ -z "${VAULT_PATH}" || -z "${LOCAL_DIR}" ]]; then
  echo "Usage: $0 <vault-path> <local-dir>" >&2
  exit 1
fi

pulled_files=0
pulled_folders=0

pull() {
  local vault_path="$1"
  local local_dir="$2"
  local json name

  mkdir -p "${local_dir}"

  json=$(nopal vault ls "${vault_path}" --json)

  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    echo "  ↓  ${vault_path}/${name}"
    nopal vault download "${vault_path}/${name}" -o "${local_dir}/${name}"
    pulled_files=$((pulled_files + 1))
  done < <(printf '%s' "${json}" | jq -r '.files[].name')

  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    pulled_folders=$((pulled_folders + 1))
    pull "${vault_path}/${name}" "${local_dir}/${name}"
  done < <(printf '%s' "${json}" | jq -r '.folders[].name')
}

pull "${VAULT_PATH}" "${LOCAL_DIR}"

echo
echo "✓  pulled ${pulled_files} file(s) across ${pulled_folders} folder(s) into ${LOCAL_DIR}"
