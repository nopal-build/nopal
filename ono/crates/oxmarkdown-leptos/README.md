# oxmarkdown-leptos

`ono`'s chosen rendering path: OxMarkdown documents rendered with
[Leptos](https://leptos.dev), on top of the shared `oxmarkdown-rs` core
(`parse_document`/`serialize_document`/`toggle_checkbox_by_index`).

## Why Leptos (verdict, from a real comparison since deleted)

Built and compared side by side against a hand-rolled `web-sys` DOM
construction spike (`oxmarkdown-web`, since deleted per this repo's own
convention: resolve a spike, preserve the findings here, delete the
code — see the `oxmarkdown` skill's own "foundation spike" precedent).
The comparison used the exact same real document, same directives, same
task-checkbox interaction, same shared `oxmarkdown-rs` core on both
sides — only the rendering layer differed.

- **Compiled clean on the first real attempt** against
  `wasm32-unknown-unknown` — no dependency conflicts, no surprises, code
  matched the API as guessed from docs.
- **The recursive renderer itself is nearly identical code** to
  `oxmarkdown-web`'s — same `match` on node `"type"`, same shared
  `oxmarkdown-rs` functions (`parse_document`/`serialize_document`/
  `toggle_checkbox_by_index`). Adopting Leptos does NOT mean throwing
  away the rendering logic already written; it's almost a mechanical
  port from `web_sys::Element`/`create_element`/`append_child` calls to
  `view! {}` macro output.
- **The entire difference is concentrated in state/interactivity** —
  exactly the part expected to get harder as more interactables
  (toggle collapse/expand, directive attribute popovers, nested
  editors) get added:
  - `oxmarkdown-web`'s checkbox click handler: re-parse, mutate,
    serialize, then MANUALLY `container.set_inner_html("")` and rebuild
    the whole subtree by hand, plus a `Closure::forget()` per checkbox
    that leaks on every re-render.
  - `oxmarkdown-leptos`'s: re-parse, mutate, serialize, `set_markdown.set(...)`.
    That's it — Leptos owns reconciling the DOM and there is nothing to
    leak.
- **Leptos has first-class SSR**, which `oxmarkdown-web`'s hand-rolled
  `web-sys` approach has no story for at all — directly relevant since
  OxRenderer's whole reason for existing (public/card pages) is SSR. Not
  exercised by this spike yet (still CSR-only, see below), but this is
  the concrete reason Leptos was the leading candidate going into this
  comparison in the first place, and nothing here contradicts it.

This is why `oxmarkdown-web` was deleted rather than kept around as a
second, parallel renderer to maintain — its only job was to be this
comparison's baseline, and that job is done.

## SSR: proven

`src/bin/ssr_server.rs` (built with `--features ssr --no-default-features`,
run with `cargo run --bin ssr_server --features ssr --no-default-features`)
renders the SAME `App` component server-side, with zero JS/WASM
involved at all, via `leptos::prelude::RenderHtml::to_html` under a
plain `Owner::new()` scope (not through `cargo-leptos`/Axum — `rouille`,
a plain synchronous HTTP crate, is enough to prove server rendering
itself works). Confirmed with `curl`: the real OxMarkdown content —
headings, directives, images, lists — is present directly in the raw
response body, not an empty shell waiting for a script tag. This is the
actual hard requirement (OxRenderer's public/card pages need content
visible with zero JS) Leptos was chosen for in the first place.

**A real gotcha found and fixed along the way**: the task checkbox's
`checked` state used `prop:checked` alone at first, which renders
IDENTICALLY (unchecked) in server output whether the item is checked or
not — a property binding is JS-only, never part of static HTML, so it
simply doesn't exist yet by the time `to_html()` runs. Fixed by setting
BOTH `checked=` (a plain HTML attribute — this is what actually shows up
in SSR output) and `prop:checked=` (so a later click still reliably
re-syncs the live DOM property once hydrated) on the same element.
Worth remembering for every future boolean/stateful attribute on this
rendering path, not just this one checkbox.

## Hydration: wired

`ssr_server` now serves a `<script type="module">` alongside its SSR'd
HTML, pointing at a SEPARATE WASM bundle built with `--features
hydrate` (not `csr`) into `ssr-pkg/` — `leptos::mount::hydrate_body`
attaches reactivity/event listeners to the EXISTING server-rendered
markup (using the `<!>` marker comments `to_html()` already embeds)
instead of tearing it down and rebuilding fresh the way `mount_to_body`
(`csr`) does. The hydrate build's entry point (`hydrate()`, a
`#[wasm_bindgen(start)]` function) runs automatically the moment the
module loads — no separate exported call needed, unlike `csr`'s
explicit `mount()`.

**A real bug found and fixed along the way**: `rouille::match_assets`
maps a request's FULL url path onto the given directory — requesting
`/pkg/oxmarkdown_leptos.js` against `ssr-pkg/` (which holds the files
directly, no nested `pkg/` subfolder) 404s internally and silently
falls through to the app-render branch, which still returns `200` but
with the WRONG content (`text/html` instead of the JS/WASM), confirmed
by checking `curl`'s reported content-type directly rather than
assuming a `200` meant it worked. Fixed with rouille's own documented
pattern: `request.remove_prefix("/pkg")` before calling
`match_assets`. Confirmed both `/pkg/oxmarkdown_leptos.js` (as
`application/javascript`) and `/pkg/oxmarkdown_leptos_bg.wasm` (as
`application/wasm` — the correct MIME type matters, since a browser's
WASM instantiation can fail or silently fall back to a slower path
without it) now serve correctly.

**What's confirmed vs. what still needs a real browser**: every step
up to the JS-execution boundary is confirmed directly (SSR content,
asset content-types, script-tag wiring, server and client running the
exact same `App` component so their rendered structure can't drift) —
but whether the checkbox click ACTUALLY works post-hydration in a real
browser hasn't been confirmed yet, since that requires executing JS/WASM,
which this environment can't do. That's the thing to check next.

Migrating off this hand-wired `rouille` setup onto real `cargo-leptos`
(which automates the SSR server + WASM bundle + hydration wiring
together, and is needed for anything beyond this proof — e.g. multiple
routes) is real follow-up work, worth doing once hydration itself is
confirmed working in a real browser.

## Not yet exercised

- Fine-grained reactivity isn't really being used here either — the
  whole document re-renders inside one big `{move || render_root(...)}`
  closure on every markdown change, matching `oxmarkdown-web`'s own
  whole-subtree-rebuild granularity for a fair, apples-to-apples
  comparison. A real implementation would likely push signals further
  down (e.g. a signal per checkbox) once there's a reason to.
- Directive rendering is still the same generic labeled-box placeholder
  as `oxmarkdown-web` — real per-directive UI is independent of which
  renderer this comparison settles.

## Running it locally

**CSR** (interactive, no SSR) — manual `wasm-bindgen` pipeline, no
`trunk` dependency:

```sh
# from ono/, the workspace root
cargo build -p oxmarkdown-leptos --target wasm32-unknown-unknown
wasm-bindgen target/wasm32-unknown-unknown/debug/oxmarkdown_leptos.wasm \
  --out-dir crates/oxmarkdown-leptos/web/pkg --target web --no-typescript

python3 -m http.server 4174 --directory crates/oxmarkdown-leptos/web
```

Then open `http://127.0.0.1:4174/`.

**SSR** (real content, zero JS, not yet interactive — see "SSR: proven"
above):

```sh
# from ono/, the workspace root
cargo run --bin ssr_server --features ssr --no-default-features
curl http://127.0.0.1:4175/
```
