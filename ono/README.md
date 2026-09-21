# ono

An eventual full replacement for [`fruits`](../fruits) — Nopal's Vault/
Daily Log/GraphLog web app — built on a Rust/WASM core instead of React
+ Lexical. See the `oxmarkdown` skill's "Build status" and the design
discussion that led here for the full reasoning; the short version:

- **Not a rewrite-everything-at-once effort.** `ono` is built up
  incrementally, bringing over only what's actually needed, one proven
  piece at a time — `fruits` keeps running unchanged throughout. There is
  no target date to "cut over"; this may take a long time, and that's
  expected.
- **A separate Cargo workspace from `crates/`** (the existing `nopal`
  CLI/GUI/API product) on purpose — this is a clean-slate effort, not an
  extension of that product's crate graph. If a piece proves valuable
  enough to share between the two, promoting it into a real shared crate
  is a deliberate decision to make later, not something to fall into by
  accident.

## Status

**Phase 0: done.** Parsing (block + inline directives, `==highlight==`)
and serializing back to markdown both work, without forking
`markdown-rs` — including the one case that actually matters (a
container directive body spanning a blank line), validated against a
real document pulled from the JS playground, not just hand-written
fixtures. See `crates/oxmarkdown-rs/README.md` for the approach and the
honestly-documented remaining gaps (directives inside blockquotes/list
items, byte-for-byte parity with the JS serializer's exact output).

**Phase 1: rendering framework decided — Leptos.** Compared side by
side against a hand-rolled `web-sys` DOM construction spike
(`oxmarkdown-web`, since deleted — its findings are preserved in
`crates/oxmarkdown-leptos/README.md`, per this repo's own convention:
resolve a spike, keep the findings, delete the code) rather than
picking blind. Short version: the recursive rendering code was nearly
identical between the two; the entire difference was in
state/interactivity (manual DOM teardown + leaked listeners vs.
`set_markdown.set(...)`), and Leptos has the first-class SSR story
hand-rolled `web-sys` had none of at all. `oxmarkdown-leptos` includes
a real interaction (clicking a task checkbox mutates the AST and saves
through the real markdown round trip via `serialize_document`, not a
visual-only toggle).

**SSR: proven.** `oxmarkdown-leptos`'s own `ssr_server` binary renders
real OxMarkdown content server-side with zero JS/WASM involved —
confirmed directly with `curl`, not assumed. This was the actual hard
requirement driving the Leptos choice (OxRenderer's public/card pages
need content visible with zero JS), and it holds up. See
`crates/oxmarkdown-leptos/README.md`'s "SSR: proven" section for the
real gotcha found and fixed along the way (a `prop:checked`-only
binding silently never appears in server-rendered HTML at all).

**Hydration: wired.** `ssr_server` now serves a separate `hydrate`-
feature WASM bundle alongside its SSR'd HTML; `leptos::mount::hydrate_body`
attaches to the existing server-rendered markup instead of rebuilding
it. Confirmed up to the JS-execution boundary (correct asset content-
types, correct script wiring, server/client sharing the exact same
`App` component) — a real bug was found and fixed along the way
(`rouille::match_assets` needing `remove_prefix` first, or asset
requests silently 404 into the wrong response). Whether the checkbox
actually works post-hydration in a real browser is the one thing left
to confirm by hand — see `crates/oxmarkdown-leptos/README.md`.

**Phase 2 (Editing mode / Lexical replacement): started, promising,
real content loading end to end.** `crates/oxmarkdown-editor` evaluates
`taino-edit` — a real ProseMirror-style Rust document model +
`contenteditable` DOM bridge for Leptos, with NO JavaScript bridge at
runtime. Far more mature than expected: a typed document tree,
invertible transforms, undo/redo, real selection/IME/clipboard
handling, 13 built-in extensions, and its own Leptos SSR support.
Confirmed directly (not taken on faith): CSR (real typing, and — after
fixing a real bug, a missing `keymap` — real Mod-b/Mod-i shortcuts) and
SSR (real content, zero JS) both work. The markdown ⟷ taino-edit-tree
conversion layer (`convert.rs`) is built and proven against the real
playground sample: headings/bold/italic/links/lists convert correctly,
and — the important case — an unsupported construct (a `:::note{...}`
directive spanning a blank line) degrades to a VISIBLE placeholder with
its real nested content preserved, never silently dropped. See
`crates/oxmarkdown-editor/README.md` for the real version mismatch
found (`taino-edit-leptos` needs Leptos 0.8; `oxmarkdown-leptos` is
still on 0.7 — fine as separate crates, a real blocker if they ever
need to merge) and what's still ahead (an actual OxMarkdown schema —
directives/checkboxes/mentions/highlight as real node/mark types — and
a couple of small, real, documented conversion gaps).

Still not decided/built: the hosting story (does `fruits` stay the
host and call into Rust for fragments, or does a Rust server take
these routes over outright), migrating off this hand-wired `rouille`
setup onto real `cargo-leptos` (needed for anything beyond a single-
route proof), and the Leptos 0.7→0.8 question that merging rendering
and editing into one surface would force.

## Layout

```
ono/
  Cargo.toml                 # workspace root
  crates/
    oxmarkdown-rs/            # Phase 0: markdown-rs + directives + highlight + serialize
    oxmarkdown-leptos/        # Phase 1: Leptos rendering — csr, ssr, and hydrate all working
    oxmarkdown-editor/        # Phase 2: taino-edit (Lexical replacement) — csr + ssr proven, minimal schema
```
