#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# vault-push.sh — recursively uploads a local directory tree into a Vault
# folder, creating any missing folders along the way. A thin wrapper
# around the existing `nopal vault` commands (mkdir, ls --json, upload) —
# no new CLI primitive, just automates the walk a human would otherwise
# do by hand, folder by folder.
#
# Usage:
#   crates/cli/scripts/vault-push.sh <local-dir> <vault-path>
#
# Example:
#   crates/cli/scripts/vault-push.sh ./garden projects/garden
#
# Safe to re-run: `nopal vault mkdir` is already idempotent, and this
# script checks each destination folder's existing file NAMES first,
# skipping anything already there rather than creating a duplicate
# (`nopal vault upload` itself has no such check — it always creates a
# new file, even if one of the same name already exists in that folder).
# This is a name-based skip, not a content diff — editing a local file
# and re-running will NOT push the change; delete the vault copy first,
# or use `nopal vault replace` directly for an in-place update.
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

LOCAL_DIR="${1:-}"
VAULT_PATH="${2:-}"

if [[ -z "${LOCAL_DIR}" || -z "${VAULT_PATH}" ]]; then
  echo "Usage: $0 <local-dir> <vault-path>" >&2
  exit 1
fi
if [[ ! -d "${LOCAL_DIR}" ]]; then
  echo "Not a directory: ${LOCAL_DIR}" >&2
  exit 1
fi

pushed_files=0
skipped_files=0
ensured_folders=0

already_exists() {
  local name="$1"
  shift
  local existing
  for existing in "$@"; do
    [[ "${existing}" == "${name}" ]] && return 0
  done
  return 1
}

push() {
  local local_dir="$1"
  local vault_path="$2"
  local existing_json entry name

  nopal vault mkdir "${vault_path}" >/dev/null
  ensured_folders=$((ensured_folders + 1))

  existing_json=$(nopal vault ls "${vault_path}" --json)
  local existing_names=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && existing_names+=("${name}")
  done < <(printf '%s' "${existing_json}" | jq -r '.files[].name')

  for entry in "${local_dir}"/*; do
    [[ -e "${entry}" ]] || continue # glob matched nothing
    name=$(basename "${entry}")

    if [[ -f "${entry}" ]]; then
      if [[ ${#existing_names[@]} -gt 0 ]] && already_exists "${name}" "${existing_names[@]}"; then
        echo "  ↷  ${vault_path}/${name} (already there, skipped)"
        skipped_files=$((skipped_files + 1))
        continue
      fi
      echo "  →  ${vault_path}/${name}"
      nopal vault upload "${entry}" --to "${vault_path}"
      pushed_files=$((pushed_files + 1))
    elif [[ -d "${entry}" ]]; then
      push "${entry}" "${vault_path}/${name}"
    fi
  done
}

push "${LOCAL_DIR}" "${VAULT_PATH}"

echo
echo "✓  uploaded ${pushed_files}, skipped ${skipped_files} (already there), ${ensured_folders} folder(s) ensured, into ${VAULT_PATH}"
