//! Throwaway stand-in for the not-yet-built `/cli-login` page and
//! `/api/cli-auth/exchange` endpoint, so `nopal login` can be exercised
//! end-to-end before the real webapp routes exist.
//!
//! Run with `cargo run --bin stub_server`, then in another terminal:
//!   `cargo run --bin cli -- login --host http://127.0.0.1:4000`
//!
//! It simulates a human immediately approving the CLI (no real auth), then
//! serves a fixed fake token from the exchange endpoint.

use serde::Deserialize;
use std::collections::HashMap;
use tiny_http::{Header, Response, Server};

const ADDR: &str = "127.0.0.1:4000";

#[derive(Debug, Deserialize)]
struct ExchangeRequest {
    code: String,
}

fn main() {
    let server = Server::http(ADDR).expect("failed to bind stub server");
    println!("Stub nopal server listening on http://{ADDR}");
    println!("Try it with:\n  cargo run --bin cli -- login --host http://{ADDR}\n");

    for request in server.incoming_requests() {
        let url = request.url().to_string();
        println!("{} {}", request.method(), url);

        if url.starts_with("/cli-login") {
            handle_cli_login(request, &url);
        } else if url.starts_with("/api/cli-auth/exchange") {
            handle_exchange(request);
        } else {
            let _ = request.respond(Response::from_string("not found").with_status_code(404));
        }
    }
}

/// Stands in for the real page: a human would see an "Authorize?" prompt
/// here. This stub skips straight to "approved" and redirects back to the
/// CLI's local callback server, exactly as the real webapp route will.
fn handle_cli_login(request: tiny_http::Request, url: &str) {
    let params = parse_query(url);
    let port = params.get("port").cloned().unwrap_or_default();
    let state = params.get("state").cloned().unwrap_or_default();
    let hostname = params.get("hostname").cloned().unwrap_or_default();

    println!("  -> simulating browser approval for CLI on '{hostname}' (callback port {port})");

    let redirect_url = format!("http://127.0.0.1:{port}/callback?code=stub-code-123&state={state}");
    let location = Header::from_bytes(&b"Location"[..], redirect_url.as_bytes())
        .expect("redirect URL is valid header value");

    let response = Response::from_string("redirecting to CLI callback...")
        .with_status_code(302)
        .with_header(location);
    let _ = request.respond(response);
}

/// Stands in for `POST /api/cli-auth/exchange`: trades the one-time code for
/// a fixed fake bearer token/email/expiry.
fn handle_exchange(mut request: tiny_http::Request) {
    let mut body = String::new();
    let _ = request.as_reader().read_to_string(&mut body);

    let parsed: Result<ExchangeRequest, _> = serde_json::from_str(&body);
    match parsed {
        Ok(payload) => {
            println!("  -> exchanging code '{}' for a stub token", payload.code);
            let json = serde_json::json!({
                "token": "stub-token-abc123",
                "email": "stub@example.com",
                "expires_at": "2026-08-14",
            });
            let content_type =
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            let response = Response::from_string(json.to_string()).with_header(content_type);
            let _ = request.respond(response);
        }
        Err(e) => {
            let response = Response::from_string(format!("bad request: {e}")).with_status_code(400);
            let _ = request.respond(response);
        }
    }
}

fn parse_query(url: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Some((_, query)) = url.split_once('?') else {
        return map;
    };
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(k)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| k.to_string());
        let val = urlencoding::decode(v)
            .map(|c| c.into_owned())
            .unwrap_or_else(|_| v.to_string());
        map.insert(key, val);
    }
    map
}
