//! Proves the actual hard requirement, now in two parts:
//!
//! 1. **Content visible with zero JS** (already proven — see this
//!    crate's README's "SSR: proven" section): every request calls
//!    `oxmarkdown_leptos::render_app_to_html()` fresh.
//! 2. **That SAME page becomes interactive after its initial paint**
//!    (hydration): the HTML this server returns includes a
//!    `<script type="module">` loading the `hydrate`-feature WASM
//!    bundle (`ssr-pkg/`, built separately from the `csr` bundle — see
//!    the README's "Running it locally"), which attaches to the
//!    EXISTING markup rather than rebuilding it.
//!
//! Deliberately NOT using `cargo-leptos`/Axum/Tokio yet — `rouille` (a
//! plain synchronous HTTP crate) is enough to prove both server
//! rendering AND hydration work, without also taking on an async
//! runtime and the full routing/asset-serving machinery `cargo-leptos`
//! provides. If this proves out, migrating to the real `cargo-leptos`
//! project shape is real follow-up work — see this crate's README.

fn main() {
    let address = "127.0.0.1:4175";
    let pkg_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/ssr-pkg");
    println!("oxmarkdown-leptos SSR+hydrate server listening on http://{address}/");
    rouille::start_server(address, move |request| {
        // `/pkg/*` — the hydrate-feature WASM bundle + its JS glue,
        // served as plain static assets (correct `application/wasm`
        // content-type confirmed via `rouille::assets`'s own extension
        // table, not assumed). `match_assets` maps the request's FULL
        // url path onto `pkg_dir` — since `ssr-pkg/` holds the files
        // directly (no nested `pkg/` subfolder), the `/pkg` prefix has
        // to be stripped first (`remove_prefix`, rouille's own
        // documented pattern for exactly this), or every lookup 404s
        // against a nonexistent `ssr-pkg/pkg/...` path — confirmed as a
        // real bug here first (assets silently fell through to the
        // app-render branch, coming back as `text/html`), not assumed.
        if let Some(asset_request) = request.remove_prefix("/pkg") {
            let asset_response = rouille::match_assets(&asset_request, pkg_dir);
            if asset_response.is_success() {
                return asset_response;
            }
        }

        let body = oxmarkdown_leptos::render_app_to_html();
        let html = format!(
            r#"<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>ono / oxmarkdown-leptos SSR + hydrate</title></head>
<body>{body}
<script type="module">
  import init from "/pkg/oxmarkdown_leptos.js";
  // `hydrate()` (the wasm-bindgen `start` function) runs automatically
  // once the module is instantiated — no separate call needed here,
  // unlike the `csr` bundle's explicit `mount()` export.
  init();
</script>
</body>
</html>
"#
        );
        rouille::Response::html(html)
    });
}
