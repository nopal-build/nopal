//! Editing-mode spike: does `taino-edit` (a real ProseMirror-style
//! rich-text editor for Leptos, no JS bridge at runtime) work in our
//! stack at all? Now loading REAL OxMarkdown content (parsed via
//! `oxmarkdown-rs`, converted via `convert.rs`) rather than a hand-
//! built one-paragraph fixture — using taino-edit's own built-in
//! extensions (paragraph, heading, bold, italic, code, link, image,
//! blockquote, code_block, lists), still no CUSTOM OxMarkdown schema
//! (directives/checkboxes/mentions/highlight as real node/mark types).
//! That's real, separate follow-up work once this proves out. See
//! `ono/README.md` and this crate's own README.

mod commands;
mod convert;

use commands::{EditingFixups, HardBreak};
use leptos::prelude::*;
#[cfg(any(feature = "csr", feature = "hydrate"))]
use wasm_bindgen::prelude::*;

use taino_edit_core::InputRules;
use taino_edit_extensions::{
    build_keymap_with, build_schema_with, Blockquote, Bold, Code, CodeBlock, Heading, History,
    Image, Italic, Link, Lists, Paragraph,
};
use taino_edit_leptos::{EditorState, Keymap, NodeSpec, SchemaBuilder, TainoEditor};

/// The exact real playground sample from
/// `fruits/app/routes/styles_.oxmarkdown.tsx`'s `DEFAULT_SAMPLE` — same
/// fixture used throughout `ono`. Deliberately kept AS-IS, directives
/// included, rather than trimmed to only what this minimal schema
/// already supports — the whole point of this pass is confirming
/// unsupported content degrades to a visible placeholder instead of
/// silently vanishing (see `convert.rs`).
const DEFAULT_SAMPLE: &str = r#"# Try editing this

Bold, *italic*, ~~strikethrough~~, inline `code`, and a [link](https://example.com).

:::note{title="Container directive"}
This paragraph is followed by a blank line inside the directive —

the exact case that broke the old regex-based system. It survives here.
:::

::badge{label="Leaf directive"}

:::gallery{max-columns="3"}
![Sunset over the bay](https://picsum.photos/seed/nopal1/400)
![Trail markers](https://picsum.photos/seed/nopal2/400)
![Fence line repair](https://picsum.photos/seed/nopal3/400)
:::

- [ ] Unchecked task
- [x] Checked task
- Plain bullet

1. Ordered
2. List

Decided to use cedar for the fence :ref{name="Jane Doe" datetime="2026-08-17T14:30:00Z" location="/x"}
non-verbose — click the asterisk.
"#;

/// `TainoEditor`'s `keymap` prop is `Option<Keymap>` and defaults to
/// `None` — the REAL bug behind "Mod-b/Mod-i don't do anything except
/// trigger the browser's own bookmarks/page-info shortcuts": without a
/// keymap installed, the component never takes ownership of keyboard
/// input at ALL (see `taino-edit-leptos`'s own doc comment on that
/// prop), so a browser-reserved combo (Cmd-b, Cmd-i) fires natively
/// (nothing ever called `preventDefault`), and a non-reserved one
/// (Ctrl-b, Option-b) does nothing at all (no OS binding, no JS
/// handler either) — the exact symptom reported. Confirmed by reading
/// `taino-edit-leptos`'s source directly, not guessed.
#[cfg(any(feature = "csr", feature = "hydrate"))]
fn is_mac() -> bool {
    web_sys::window()
        .and_then(|w| w.navigator().platform().ok())
        .map(|p| p.to_lowercase().contains("mac"))
        .unwrap_or(false)
}

#[cfg(not(any(feature = "csr", feature = "hydrate")))]
fn is_mac() -> bool {
    // SSR never runs interactive keyboard handling — this value is
    // inert there; picking a fixed default rather than reaching for a
    // real `navigator` (which doesn't exist server-side at all).
    false
}

/// The starting document: `?doc=<url-encoded markdown>` if present in the
/// page's own URL, else `DEFAULT_SAMPLE`. This exists purely so headless
/// e2e tests (see `ono/e2e/`) can load a small, hermetic, per-test fixture
/// instead of fighting with `DEFAULT_SAMPLE`'s large, evolving content —
/// there's no other consumer of this today. `UrlSearchParams::get` handles
/// percent-decoding itself, so no separate decode step is needed.
#[cfg(any(feature = "csr", feature = "hydrate"))]
fn initial_markdown() -> String {
    web_sys::window()
        .and_then(|w| w.location().search().ok())
        .and_then(|search| web_sys::UrlSearchParams::new_with_str(&search).ok())
        .and_then(|params| params.get("doc"))
        .filter(|doc| !doc.is_empty())
        .unwrap_or_else(|| DEFAULT_SAMPLE.to_string())
}

#[cfg(not(any(feature = "csr", feature = "hydrate")))]
fn initial_markdown() -> String {
    DEFAULT_SAMPLE.to_string()
}

#[cfg(feature = "csr")]
#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

#[cfg(feature = "csr")]
#[wasm_bindgen]
pub fn mount() {
    leptos::mount::mount_to_body(App);
}

#[cfg(feature = "hydrate")]
#[wasm_bindgen(start)]
pub fn hydrate() {
    console_error_panic_hook::set_once();
    leptos::mount::hydrate_body(App);
}

/// Same shared-component pattern `oxmarkdown-leptos` uses — `App` is
/// called both by the CSR/hydrate WASM entry points above and by
/// `render_app_to_html` below (native, no WASM), so server and client
/// can never structurally drift.
#[cfg(feature = "ssr")]
pub fn render_app_to_html() -> String {
    let owner = leptos::prelude::Owner::new();
    owner.set();
    leptos::prelude::RenderHtml::to_html(App())
}

fn build_editor(markdown: &str) -> (EditorState, Keymap, InputRules) {
    // taino-edit's own built-in extensions — enough to cover ordinary
    // CommonMark/GFM content. A real OxMarkdown schema (directives/
    // checkboxes/mentions/highlight as real node/mark types, via the
    // `Extension` trait) is the actual follow-up work; the point of
    // this pass is proving the markdown -> taino-edit-tree conversion
    // itself works on REAL content first — see `convert.rs`.
    let base = SchemaBuilder::new()
        .node(
            "doc",
            NodeSpec {
                content: Some("block+".into()),
                ..Default::default()
            },
        )
        .node(
            "text",
            NodeSpec {
                group: Some("inline".into()),
                ..Default::default()
            },
        );
    // `EditingFixups` (see `commands.rs`) contributes no schema of its
    // own — only Enter overrides — so it's fine that it's absent from
    // `build_schema_with`'s own extension list below; it only needs to
    // be present for the KEYMAP build. Placed AFTER `Lists` so its
    // "Enter" binding is tried FIRST (chaining tries the LATEST-added
    // entry first, falling back to earlier ones), then falls through to
    // `Lists`'s own smart Enter, then the base keymap's plain split.
    let exts: Vec<&dyn taino_edit_extensions::Extension> = vec![
        &Paragraph,
        &Heading,
        &Bold,
        &Italic,
        &Code,
        &Link,
        &Image,
        &Blockquote,
        &CodeBlock,
        &Lists,
        &HardBreak,
        &History,
    ];
    let schema = build_schema_with(base, &exts, "doc").unwrap();
    let keymap_exts: Vec<&dyn taino_edit_extensions::Extension> = {
        let mut all = exts.clone();
        all.push(&EditingFixups);
        all
    };
    let keymap = build_keymap_with(&keymap_exts, &schema, is_mac());
    let input_rules = commands::build_input_rules(&schema);

    let doc = convert::markdown_to_doc(&schema, markdown);
    (EditorState::new(doc, schema), keymap, input_rules)
}

#[component]
fn App() -> impl IntoView {
    let (initial_state, keymap, input_rules) = build_editor(&initial_markdown());
    let state = RwSignal::new(initial_state);

    // `taino-edit-dom`/`taino-edit-leptos` never call `InputRules::apply`
    // anywhere (confirmed by reading both crates' source; see
    // `commands.rs`'s own doc comment) - this listener is the ENTIRE
    // integration.
    //
    // A generic Leptos `Effect::new` was tried first and rejected: its
    // ordering relative to `TainoEditor`'s OWN internal state->DOM/caret
    // reconciliation effect (also a Leptos effect) is not guaranteed,
    // since both run on Leptos's shared async reactive schedule.
    // `taino-edit-leptos`'s own keydown handler explicitly avoids
    // `Effect` for exactly this reason (applies its own results
    // synchronously so the DOM/caret can't fall out of step), and its
    // CHANGELOG documents a previously-fixed bug in exactly this class
    // (a race between the selectionchange mirror and a reactive effect's
    // DOM-selection re-sync).
    //
    // Fix: a plain `on:input` DOM listener on a wrapping `<div>` around
    // `<TainoEditor>`, relying on well-defined DOM event bubbling order
    // instead of Leptos's effect scheduling. `TainoEditor` attaches its
    // own "input" listener to its INNER contenteditable element and
    // updates `state` SYNCHRONOUSLY from it (confirmed by reading
    // `taino-edit-leptos`'s source); a listener on an ANCESTOR div fires
    // AFTER it during the bubble phase, by which point `state` already
    // reflects the just-typed character. `get_untracked`/`with_value` are
    // used (not `get`/reactive tracking) since this is a plain event
    // callback, not a reactive computation. Harmless on input that
    // doesn't match any rule (`apply` just returns `None`), and
    // self-terminating on input that does (the matched trigger text is
    // consumed as part of applying the rule). Never fires under SSR (no
    // DOM events during server rendering).
    let input_rules = StoredValue::new_local(input_rules);
    let on_input = move |_: leptos::ev::Event| {
        let current = state.get_untracked();
        if let Some(tx) = input_rules.with_value(|rules| rules.apply(&current)) {
            state.set(current.apply(tx));
        }
    };

    view! {
        <div id="app">
            <p class="ox-status-inline">
                "oxmarkdown-editor spike - taino-edit, minimal built-in schema (no OxMarkdown extensions yet)."
            </p>
            <div on:input=on_input>
                <TainoEditor state=state keymap=keymap />
            </div>
        </div>
    }
}
