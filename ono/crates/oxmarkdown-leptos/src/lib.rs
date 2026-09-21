//! `ono`'s chosen rendering path: OxMarkdown via Leptos, in three
//! builds sharing the same `App` component — `csr` (standalone browser
//! demo, no server involved), `ssr` (native, `src/bin/ssr_server.rs`,
//! zero JS), and `hydrate` (the WASM bundle `ssr_server` itself serves
//! alongside its SSR'd HTML, attaching interactivity to that existing
//! markup instead of building fresh DOM). See `ono/README.md` and this
//! crate's own README for how each was proven out.

use leptos::prelude::*;
use oxmarkdown_rs::{parse_document, serialize_document, toggle_checkbox_by_index};
use serde_json::Value;
#[cfg(any(feature = "csr", feature = "hydrate"))]
use wasm_bindgen::prelude::*;

/// The exact real playground sample from
/// `fruits/app/routes/styles_.oxmarkdown.tsx`'s `DEFAULT_SAMPLE` — same
/// fixture used everywhere else in `ono`, so this is a genuine
/// apples-to-apples comparison against `oxmarkdown-web`.
const DEFAULT_SAMPLE: &str = r#"# Try editing this

Bold, *italic*, ~~strikethrough~~, inline `code`, and a [link](https://example.com).

Spacing   preserved   exactly   as   saved — even   runs   of   2+ — on every surface (see the oxmarkdown skill's Design language section).

:::note{title="Container directive"}
This paragraph is followed by a blank line inside the directive —

the exact case that broke the old regex-based system. It survives here.
:::

::badge{label="Leaf directive"}

::unregistered{demo="unknown directive fallback"}

:::grid{columns="3"}
First cell — any block content works here (headings, lists, ...).

::col
Second cell.

::col
Third cell.
:::

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

Decided to use cedar for the fence :ref{name="Jane Doe" human-id="h_demo" datetime="2026-08-17T14:30:00Z" location="/h_demo:personal/syncs/Daily Logs/2026-08-17.md"}
non-verbose — click the asterisk.

Decided to use cedar for the fence :ref{name="Jane Doe" human-id="h_demo" datetime="2026-08-17T14:30:00Z" location="/h_demo:personal/syncs/Daily Logs/2026-08-17.md" verbose="true"}
verbose — always fully spelled out, no popover.
"#;

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

/// The hydrate build's entry point — unlike `csr`'s split `main`/`mount`
/// (panic hook set up first, DOM work triggered separately by an
/// explicit JS call), hydration runs everything immediately on module
/// load: by the time this WASM module's own `<script type="module">`
/// runs, the browser has already parsed and painted the real SSR'd
/// HTML, so there's no reason to delay attaching to it.
/// `leptos::mount::hydrate_body` walks that EXISTING markup (using the
/// `<!>` marker comments `to_html()` already embeds — visible in the
/// `ssr_server` `curl` output) and attaches reactivity/event listeners
/// to it in place, rather than tearing it down and rebuilding fresh the
/// way `mount_to_body` (CSR) does.
#[cfg(feature = "hydrate")]
#[wasm_bindgen(start)]
pub fn hydrate() {
    console_error_panic_hook::set_once();
    leptos::mount::hydrate_body(App);
}

/// Renders `App` to a plain HTML string, server-side, with no browser/
/// WASM involved at all — this is the actual thing being proven out:
/// can OxRenderer's real requirement (public/card pages need content
/// visible with zero JS execution) be met on this stack. Called by
/// `src/bin/ssr_server.rs`.
#[cfg(feature = "ssr")]
pub fn render_app_to_html() -> String {
    let owner = leptos::prelude::Owner::new();
    owner.set();
    leptos::prelude::RenderHtml::to_html(App())
}

#[component]
fn App() -> impl IntoView {
    // The single source of truth is the raw markdown TEXT (same
    // principle `oxmarkdown-web` follows — see its own module doc) —
    // every interaction re-parses from here, mutates, re-serializes
    // back into here. Unlike `oxmarkdown-web`, there is no manual
    // `set_inner_html("")`/rebuild-by-hand step anywhere below — Leptos
    // owns that entirely; this component just describes what the view
    // SHOULD be for the current `markdown` value.
    let (markdown, set_markdown) = signal(DEFAULT_SAMPLE.to_string());

    view! {
        <div id="app">{move || render_root(&markdown.get(), markdown, set_markdown)}</div>
    }
}

fn render_root(
    markdown_text: &str,
    markdown: ReadSignal<String>,
    set_markdown: WriteSignal<String>,
) -> AnyView {
    match parse_document(markdown_text) {
        Ok(doc) => {
            let mut counter = 0usize;
            render_children(&doc, markdown, set_markdown, &mut counter)
        }
        Err(err) => {
            view! { <pre class="ox-parse-error">{format!("Parse error: {err}")}</pre> }.into_any()
        }
    }
}

fn render_children(
    node: &Value,
    markdown: ReadSignal<String>,
    set_markdown: WriteSignal<String>,
    counter: &mut usize,
) -> AnyView {
    let items: Vec<AnyView> = node["children"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|child| render_node(child, markdown, set_markdown, counter))
                .collect()
        })
        .unwrap_or_default();
    items.into_any()
}

fn render_node(
    node: &Value,
    markdown: ReadSignal<String>,
    set_markdown: WriteSignal<String>,
    counter: &mut usize,
) -> AnyView {
    let node_type = node["type"].as_str().unwrap_or("");
    match node_type {
        "text" => {
            let value = node["value"].as_str().unwrap_or("").to_string();
            view! { {value} }.into_any()
        }
        "heading" => {
            let depth = node["depth"].as_u64().unwrap_or(1).clamp(1, 6);
            let children = render_children(node, markdown, set_markdown, counter);
            match depth {
                1 => view! { <h1>{children}</h1> }.into_any(),
                2 => view! { <h2>{children}</h2> }.into_any(),
                3 => view! { <h3>{children}</h3> }.into_any(),
                4 => view! { <h4>{children}</h4> }.into_any(),
                5 => view! { <h5>{children}</h5> }.into_any(),
                _ => view! { <h6>{children}</h6> }.into_any(),
            }
        }
        "paragraph" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <p>{children}</p> }.into_any()
        }
        "strong" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <strong>{children}</strong> }.into_any()
        }
        "emphasis" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <em>{children}</em> }.into_any()
        }
        "delete" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <del>{children}</del> }.into_any()
        }
        "mark" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <mark>{children}</mark> }.into_any()
        }
        "blockquote" => {
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <blockquote>{children}</blockquote> }.into_any()
        }
        "inlineCode" => {
            let value = node["value"].as_str().unwrap_or("").to_string();
            view! { <code>{value}</code> }.into_any()
        }
        "code" => {
            let value = node["value"].as_str().unwrap_or("").to_string();
            view! { <pre><code>{value}</code></pre> }.into_any()
        }
        "link" => {
            let url = node["url"].as_str().unwrap_or("").to_string();
            let children = render_children(node, markdown, set_markdown, counter);
            view! { <a href=url>{children}</a> }.into_any()
        }
        "image" => {
            let url = node["url"].as_str().unwrap_or("").to_string();
            let alt = node["alt"].as_str().unwrap_or("").to_string();
            view! { <img src=url alt=alt /> }.into_any()
        }
        "list" => {
            let ordered = node["ordered"].as_bool().unwrap_or(false);
            let children = render_children(node, markdown, set_markdown, counter);
            if ordered {
                view! { <ol>{children}</ol> }.into_any()
            } else {
                view! { <ul>{children}</ul> }.into_any()
            }
        }
        "listItem" => render_list_item(node, markdown, set_markdown, counter),
        "thematicBreak" => view! { <hr /> }.into_any(),
        "break" => view! { <br /> }.into_any(),
        "yaml" => ().into_any(),
        "leafDirective" | "containerDirective" | "textDirective" => {
            render_directive(node, node_type, markdown, set_markdown, counter)
        }
        other => {
            let msg = format!("[unrendered node type: {other}]");
            view! { <div class="ox-unknown-node">{msg}</div> }.into_any()
        }
    }
}

/// A real, controlled checkbox: `prop:checked` is bound to the current
/// parsed state (not just the initial HTML attribute), and `on:click`
/// re-parses the CURRENT saved text, flips the Nth checkbox (same
/// index-based identity `oxmarkdown-web` uses — see
/// `oxmarkdown_rs::toggle_checkbox_by_index`'s own doc for why that's a
/// deliberate, temporary shortcut), re-serializes, and saves. Setting
/// `set_markdown` is the ENTIRE re-render step — no manual DOM
/// teardown/rebuild, no listener bookkeeping to leak. This is the
/// concrete difference from `oxmarkdown-web`'s own version of this same
/// function worth comparing directly.
fn render_list_item(
    node: &Value,
    markdown: ReadSignal<String>,
    set_markdown: WriteSignal<String>,
    counter: &mut usize,
) -> AnyView {
    let children = render_children(node, markdown, set_markdown, counter);
    match node["checked"].as_bool() {
        Some(checked) => {
            let index = *counter;
            *counter += 1;
            let on_click = move |_| {
                let current = markdown.get_untracked();
                if let Ok(mut tree) = parse_document(&current) {
                    if toggle_checkbox_by_index(&mut tree, index) {
                        set_markdown.set(serialize_document(&tree));
                    }
                }
            };
            // Both `checked=` (a plain HTML attribute, needed so the
            // right state actually shows up in SERVER-rendered HTML
            // with zero JS executed — confirmed by curl against
            // `ssr_server` that `prop:` ALONE renders identically
            // whether checked or not, since a property binding is a
            // JS-only concept, never part of the static markup) AND
            // `prop:checked=` (so a later click reliably re-syncs the
            // live DOM property once hydrated, not just the attribute)
            // are needed together — a real gotcha worth getting right
            // now rather than after building on top of a checkbox that
            // silently only worked in the CSR-only demo.
            view! {
                <li>
                    <input type="checkbox" checked=checked prop:checked=checked on:click=on_click />
                    {children}
                </li>
            }
            .into_any()
        }
        None => view! { <li>{children}</li> }.into_any(),
    }
}

/// Every directive kind renders as a generic, visibly-labeled box —
/// same deliberate scope as `oxmarkdown-web`'s own version; real per-
/// directive rendering is later work, independent of which renderer
/// this comparison settles on.
fn render_directive(
    node: &Value,
    kind: &str,
    markdown: ReadSignal<String>,
    set_markdown: WriteSignal<String>,
    counter: &mut usize,
) -> AnyView {
    let name = node["name"].as_str().unwrap_or("?").to_string();
    let attrs_str = node["attributes"]
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(k, v)| format!("{k}=\"{}\"", v.as_str().unwrap_or("")))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    let marker = match kind {
        "leafDirective" => "::",
        "containerDirective" => ":::",
        _ => ":",
    };
    let label = format!("{marker}{name}{{{attrs_str}}}");
    let class = format!("ox-directive ox-directive-{kind}");

    match kind {
        "containerDirective" => {
            let body = render_children(node, markdown, set_markdown, counter);
            view! {
                <div class=class data-directive-name=name>
                    <span class="ox-directive-label">{label}</span>
                    <div class="ox-directive-body">{body}</div>
                </div>
            }
            .into_any()
        }
        "leafDirective" => view! {
            <div class=class data-directive-name=name>
                <span class="ox-directive-label">{label}</span>
            </div>
        }
        .into_any(),
        _ => view! {
            <span class=class data-directive-name=name>
                <span class="ox-directive-label">{label}</span>
            </span>
        }
        .into_any(),
    }
}
