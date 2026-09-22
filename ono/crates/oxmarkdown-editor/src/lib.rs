//! Editing-mode spike: does `taino-edit` (a real ProseMirror-style
//! rich-text editor for Leptos, no JS bridge at runtime) work in our
//! stack at all? Loads REAL OxMarkdown content (parsed via
//! `oxmarkdown-rs`, converted via `convert.rs`) using taino-edit's own
//! built-in extensions (paragraph, heading, bold, italic, code, link,
//! image, blockquote, code_block, lists) PLUS the real OxMarkdown-
//! specific schema additions in `oxmarkdown_schema` (directives,
//! checkboxes, highlight, strikethrough) — see that module's own doc
//! comment for what each is and the real constraints found building
//! them. `@`-mentions need no schema addition at all: the real product's
//! own convention (see the `oxmarkdown` skill) saves a mention as a
//! plain `[@Name](path)` link, already covered by the built-in `Link`
//! extension. See `ono/README.md` and this crate's own README.

mod commands;
mod convert;
mod oxmarkdown_schema;

use commands::EditingFixups;
use leptos::prelude::*;
use oxmarkdown_schema::{Checkbox, CheckboxTogglePlugin, Directives, Highlight, Strikethrough};
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

/// A second, separate CSR entry point, mounted by `web/playground.html`
/// (NOT `index.html`) — a live markdown-source-to-rendered-HTML split
/// view for isolating one directive/syntax construct at a time, rather
/// than always testing against the full `DEFAULT_SAMPLE`. CSR-only,
/// deliberately: it's a dev tool, not part of the editor surface itself,
/// so there's no SSR/hydrate variant.
#[cfg(feature = "csr")]
#[wasm_bindgen]
pub fn mount_playground() {
    leptos::mount::mount_to_body(PlaygroundApp);
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

/// Every extension THIS schema is built from, excluding `EditingFixups`
/// (which contributes no schema of its own, only keymap overrides — see
/// `build_editor` below). Shared between `build_schema` (used alone by
/// the playground page, which needs no keymap) and `build_editor` (the
/// main app, which needs the SAME list again to build the keymap).
fn base_extensions() -> Vec<&'static dyn taino_edit_extensions::Extension> {
    vec![
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
        &History,
        &Highlight,
        &Strikethrough,
        &Directives,
        &Checkbox,
    ]
}

fn build_schema() -> taino_edit_leptos::Schema {
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
    build_schema_with(base, &base_extensions(), "doc").unwrap()
}

fn build_editor(markdown: &str) -> (EditorState, Keymap, InputRules) {
    let schema = build_schema();
    // Placed AFTER everything else so its "Enter" binding is tried FIRST
    // (chaining tries the LATEST-added entry first, falling back to
    // earlier ones), then falls through to `Lists`'s own smart Enter,
    // then the base keymap's plain split.
    let keymap_exts: Vec<&dyn taino_edit_extensions::Extension> = {
        let mut all = base_extensions();
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
                "oxmarkdown-editor - taino-edit, with real OxMarkdown directives/checkboxes/highlight/strikethrough."
            </p>
            <div on:input=on_input>
                <TainoEditor
                    state=state
                    keymap=keymap
                    plugins=vec![Box::new(CheckboxTogglePlugin)]
                />
            </div>
        </div>
    }
}

/// A short starting sample exercising every currently-supported
/// OxMarkdown-specific construct at once (the three directive kinds,
/// checkboxes, highlight, strikethrough) — small enough to read in one
/// glance, unlike `DEFAULT_SAMPLE`, which the main editor page keeps
/// deliberately large/varied instead.
#[cfg(feature = "csr")]
const PLAYGROUND_SAMPLE: &str = r#"::badge{label="Leaf directive"}

:::note{title="Container directive"}
A container directive holds real, separately editable blocks.

Even across a blank line like this one.
:::

See :ref{name="Jane" location="/x"} for the inline (text) directive.

- [ ] Unchecked task
- [x] Checked task

==Highlighted== and ~~struck through~~ text.
"#;

/// The right column's own render, via the exact function `render_app_to_
/// html`/SSR uses (`doc_view_html`) — a plain, deterministic, read-only
/// HTML string. Deliberately NOT a second live `<TainoEditor>` instance:
/// this is meant to isolate what a given markdown source converts+
/// renders to, not to be independently editable (which would let the
/// two columns drift out of sync with each other).
#[cfg(feature = "csr")]
fn render_markdown_html(schema: &taino_edit_leptos::Schema, markdown: &str) -> String {
    let doc = convert::markdown_to_doc(schema, markdown);
    taino_edit_leptos::doc_view_html(&doc)
}

#[cfg(feature = "csr")]
fn textarea_value(ev: &leptos::ev::Event) -> String {
    use wasm_bindgen::JsCast;
    ev.target()
        .and_then(|t| t.dyn_into::<web_sys::HtmlTextAreaElement>().ok())
        .map(|el| el.value())
        .unwrap_or_default()
}

#[cfg(feature = "csr")]
#[component]
fn PlaygroundApp() -> impl IntoView {
    let schema = build_schema();
    let markdown = RwSignal::new(PLAYGROUND_SAMPLE.to_string());
    let rendered_html = RwSignal::new(render_markdown_html(&schema, &markdown.get_untracked()));

    let on_input = move |ev: leptos::ev::Event| {
        let text = textarea_value(&ev);
        rendered_html.set(render_markdown_html(&schema, &text));
        markdown.set(text);
    };

    view! {
        <div id="playground">
            <div class="playground-col">
                <h2>"Markdown source"</h2>
                <textarea
                    class="playground-source"
                    on:input=on_input
                    prop:value=move || markdown.get()
                ></textarea>
            </div>
            <div class="playground-col">
                <h2>"Rendered"</h2>
                <div class="taino-editor playground-rendered" inner_html=move || rendered_html.get()></div>
            </div>
        </div>
    }
}
