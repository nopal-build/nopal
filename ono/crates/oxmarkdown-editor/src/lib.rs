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

use commands::EditingFixups;
use leptos::prelude::*;
#[cfg(any(feature = "csr", feature = "hydrate"))]
use wasm_bindgen::prelude::*;

use taino_edit_core::InputRules;
use taino_edit_extensions::{
    build_keymap_with, build_schema_with, Blockquote, Bold, Code, CodeBlock, Heading, Image,
    Italic, Link, Lists, Paragraph,
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

fn build_editor() -> (EditorState, Keymap, InputRules) {
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
    ];
    let schema = build_schema_with(base, &exts, "doc").unwrap();
    let keymap_exts: Vec<&dyn taino_edit_extensions::Extension> = {
        let mut all = exts.clone();
        all.push(&EditingFixups);
        all
    };
    let keymap = build_keymap_with(&keymap_exts, &schema, is_mac());
    let input_rules = commands::build_input_rules(&schema);

    let doc = convert::markdown_to_doc(&schema, DEFAULT_SAMPLE);
    (EditorState::new(doc, schema), keymap, input_rules)
}

#[component]
fn App() -> impl IntoView {
    let (initial_state, keymap, input_rules) = build_editor();
    let state = RwSignal::new(initial_state);

    // `taino-edit-dom`/`taino-edit-leptos` never call `InputRules::apply`
    // anywhere (confirmed by reading both crates' source — see
    // `commands.rs`'s own doc comment) — this Effect is the ENTIRE
    // integration. Runs after every state change (typing, clicks,
    // keymap commands alike); harmless on a change that doesn't match
    // any rule (`apply` just returns `None`), and self-terminating on a
    // change that does (the matched trigger text is consumed as part of
    // applying the rule, so applying it a second time finds nothing left
    // to match). A no-op under SSR — Leptos never runs `Effect`s during
    // server rendering.
    let input_rules = StoredValue::new_local(input_rules);
    Effect::new(move |_| {
        let current = state.get();
        if let Some(tx) = input_rules.with_value(|rules| rules.apply(&current)) {
            state.set(current.apply(tx));
        }
    });

    view! {
        <div id="app">
            <p class="ox-status-inline">
                "oxmarkdown-editor spike \u{2014} taino-edit, minimal built-in schema (no OxMarkdown extensions yet)."
            </p>
            <TainoEditor state=state keymap=keymap />
        </div>
    }
}
