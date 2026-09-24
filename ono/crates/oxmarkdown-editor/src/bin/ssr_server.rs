//! `taino-edit`'s own README specifically advertises Leptos SSR
//! (`<TainoEditor>` server-renders the initial document as real HTML,
//! backed by a tested `doc_view_html` <-> `EditorView::mount` markup
//! contract) — worth confirming ourselves directly rather than taking
//! the claim on faith, same as `oxmarkdown-leptos`'s own `ssr_server`.
//!
//! Note the pre-hydration document is, per their own docs, deliberately
//! NOT editable (typing before the WASM boots would be lost silently) —
//! this binary only proves the "real content, zero JS" half; hydration
//! (making it live) is further follow-up work, not attempted here yet.

fn main() {
    let address = "127.0.0.1:4177";
    println!("oxmarkdown-editor SSR server listening on http://{address}/");
    rouille::start_server(address, move |_request| {
        let body = oxmarkdown_editor::render_app_to_html();
        let html = format!(
            "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\" /><title>ono / oxmarkdown-editor SSR</title></head>\n<body>{body}</body>\n</html>\n"
        );
        rouille::Response::html(html)
    });
}
