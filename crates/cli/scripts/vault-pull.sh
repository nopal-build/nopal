#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# vault-pull.sh — recursively downloads a Vault folder tree into a local
# directory. A thin wrapper around the existing `nopal vault` commands
# (ls --json, download) — no new CLI primitive, just automates the walk a
# human would otherwise do by hand, folder by folder.
#
# Usage:
#   vault-pull.sh [--delete] <vault-path> <local-dir>
#
# Example:
#   vault-pull.sh projects/garden ./garden-pulled
#   vault-pull.sh --delete "projects/O.No Garden" garden
#
# Without --delete, pulling is purely additive (the original behavior) —
# re-running overwrites local files with whatever's currently in the
# vault, but stale local content from a since-renamed/removed vault
# folder is left behind untouched.
#
# --delete makes the local copy an exact mirror of the vault instead: at
# every level, any local file/folder NOT present in the vault's current
# listing there is removed. Only sensible when the vault is the source of
# truth and local is just a checkout — pair this with a local git repo
# (see garden/README.md) so any over-deletion is trivially recoverable
# via `git diff`/`git checkout` rather than actually destructive.
#
# Folders are matched by NAME, not id, either way — a folder renamed in
# the vault since the last pull shows up as a new local directory (and,
# with --delete, the old-named one is removed) rather than detected as a
# rename.
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

DELETE_STALE=0
if [[ "${1:-}" == "--delete" ]]; then
  DELETE_STALE=1
  shift
fi

VAULT_PATH="${1:-}"
LOCAL_DIR="${2:-}"

if [[ -z "${VAULT_PATH}" || -z "${LOCAL_DIR}" ]]; then
  echo "Usage: $0 [--delete] <vault-path> <local-dir>" >&2
  exit 1
fi

pulled_files=0
pulled_folders=0
deleted_count=0

contains() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "${candidate}" == "${needle}" ]] && return 0
  done
  return 1
}

pull() {
  local vault_path="$1"
  local local_dir="$2"
  local json name entry

  mkdir -p "${local_dir}"

  json=$(nopal vault ls "${vault_path}" --json)

  local vault_files=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && vault_files+=("${name}")
  done < <(printf '%s' "${json}" | jq -r '.files[].name')

  local vault_folders=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] && vault_folders+=("${name}")
  done < <(printf '%s' "${json}" | jq -r '.folders[].name')

  if [[ ${#vault_files[@]} -gt 0 ]]; then
    for name in "${vault_files[@]}"; do
      echo "  ↓  ${vault_path}/${name}"
      nopal vault download "${vault_path}/${name}" -o "${local_dir}/${name}"
      pulled_files=$((pulled_files + 1))
    done
  fi

  if [[ ${#vault_folders[@]} -gt 0 ]]; then
    for name in "${vault_folders[@]}"; do
      pulled_folders=$((pulled_folders + 1))
      pull "${vault_path}/${name}" "${local_dir}/${name}"
    done
  fi

  if [[ "${DELETE_STALE}" -eq 1 ]]; then
    for entry in "${local_dir}"/*; do
      [[ -e "${entry}" ]] || continue # glob matched nothing
      name=$(basename "${entry}")

      if [[ -f "${entry}" ]]; then
        if [[ ${#vault_files[@]} -eq 0 ]] || ! contains "${name}" "${vault_files[@]}"; then
          echo "  ✗  removing stale local file ${entry} (not in vault)"
          rm -f "${entry}"
          deleted_count=$((deleted_count + 1))
        fi
      elif [[ -d "${entry}" ]]; then
        if [[ ${#vault_folders[@]} -eq 0 ]] || ! contains "${name}" "${vault_folders[@]}"; then
          echo "  ✗  removing stale local folder ${entry}/ (not in vault)"
          rm -rf "${entry}"
          deleted_count=$((deleted_count + 1))
        fi
      fi
    done
  fi
}

pull "${VAULT_PATH}" "${LOCAL_DIR}"

echo
if [[ "${DELETE_STALE}" -eq 1 ]]; then
  echo "✓  pulled ${pulled_files} file(s) across ${pulled_folders} folder(s), removed ${deleted_count} stale local entr(y/ies), into ${LOCAL_DIR}"
else
  echo "✓  pulled ${pulled_files} file(s) across ${pulled_folders} folder(s) into ${LOCAL_DIR}"
fi
