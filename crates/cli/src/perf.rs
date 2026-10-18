//! `nopal perf ...` — direct read access to server request-performance
//! traces (`requestPerf.server.ts`'s `perf_requests`/`perf_request_events`
//! tables), for a human OR an AI agent to inspect real, code-measured
//! server-side timings without going through the `/maker/performance` web
//! dashboard. This is deliberately meant to be the PRIMARY way this data
//! gets used (see the `fruits-performance-monitoring` garden seed): an
//! agent runs `nopal perf recent --json`, picks the slowest/most relevant
//! request, then `nopal perf show <id> --json` to see its full
//! function/DB-call breakdown and reason about the real bottleneck
//! directly, rather than a human reading a dashboard and describing it
//! back in words.
//!
//! Thin client over `GET /api/performance/*` (Admin/Super only
//! server-side, same gate as `/maker/performance` — needs a login with
//! that role; see `nopal login`). Every `--json` flag here prints the
//! server's own JSON response VERBATIM (`serde_json::Value`, not a
//! Rust-struct round-trip), so an agent always sees the full, un-lossy
//! shape even as fields get added server-side later without this file
//! needing to change.

use std::error::Error;

use crate::vault::Client;

fn format_ms(ms: f64) -> String {
    if ms < 1000.0 {
        format!("{}ms", ms as i64)
    } else {
        format!("{:.2}s", ms / 1000.0)
    }
}

fn num(v: &serde_json::Value, key: &str) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

fn str_field<'a>(v: &'a serde_json::Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// `nopal perf summary [--days 7|30] [--json]` — high-level stats across
/// every traced route: request count, avg/p95/max duration, error count,
/// and a by-route breakdown. Good first call for "is anything slow right
/// now" — the same numbers the Maker landing page's own Performance
/// section shows.
pub fn summary(days: u32, json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let days = if days == 30 { 30 } else { 7 };
    let path = format!("/api/performance/summary?days={days}");
    let resp: serde_json::Value = client.get_json(&path)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let s = resp.get("summary").cloned().unwrap_or_default();
    let request_count = num(&s, "requestCount");
    if request_count == 0.0 {
        println!("No traced requests in the last {days} days.");
        return Ok(());
    }
    println!("=== Performance summary (last {days} days) ===");
    println!(
        "{} traced request(s) · avg {} · p95 {} · worst {} · {} error(s)",
        request_count as i64,
        format_ms(num(&s, "avgDurationMs")),
        format_ms(num(&s, "p95DurationMs")),
        format_ms(num(&s, "maxDurationMs")),
        num(&s, "errorCount") as i64
    );
    println!();
    println!("By route (slowest average first):");
    if let Some(by_route) = s.get("byRoute").and_then(|v| v.as_array()) {
        for r in by_route {
            println!(
                "  {:<40} avg {:>8}  worst {:>8}  {} req",
                str_field(r, "route"),
                format_ms(num(r, "avgDurationMs")),
                format_ms(num(r, "maxDurationMs")),
                num(r, "requestCount") as i64
            );
        }
    }
    Ok(())
}

/// `nopal perf recent [--limit 50] [--json]` — most recent traced
/// requests, newest first. Each row's `_id` is what to pass to
/// `nopal perf show` for its full timeline.
pub fn recent(limit: u32, json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let path = format!("/api/performance/recent?limit={limit}");
    let resp: serde_json::Value = client.get_json(&path)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let empty = Vec::new();
    let requests = resp
        .get("requests")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    if requests.is_empty() {
        println!("No traced requests yet.");
        return Ok(());
    }
    for r in requests {
        println!(
            "{:<10} {:<6} {:<30} {:>8}  {}  {}",
            str_field(r, "_id"),
            str_field(r, "method"),
            str_field(r, "route"),
            format_ms(num(r, "duration_ms")),
            str_field(r, "started_at"),
            if str_field(r, "outcome") == "error" {
                "ERROR"
            } else {
                "ok"
            },
        );
    }
    Ok(())
}

/// `nopal perf show <request_id> [--json]` — one request's own full
/// fn/db event timeline, in order, with each event's own duration — the
/// actual breakdown of where time went inside that one request. This is
/// the one most worth reaching for `--json` on: an agent can sum the
/// `"db"` events vs. the `"fn"` events vs. the request's own total to see
/// exactly how much is DB round trips vs. everything else.
pub fn show(request_id: &str, json: bool) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let path = format!("/api/performance/requests/{request_id}");
    let resp: serde_json::Value = client.get_json(&path)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&resp)?);
        return Ok(());
    }

    let req = resp.get("request").cloned().unwrap_or_default();
    let empty = Vec::new();
    let events = resp
        .get("events")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);

    println!(
        "{} {} — {} ({})",
        str_field(&req, "method"),
        str_field(&req, "route"),
        format_ms(num(&req, "duration_ms")),
        str_field(&req, "outcome"),
    );
    println!("Started {}", str_field(&req, "started_at"));
    println!();
    if events.is_empty() {
        println!("No events recorded — the total above is everything outside any timed call.");
        return Ok(());
    }
    for e in events {
        println!(
            "  [{:<3}] {:<40} {:>8}  {}",
            str_field(e, "type"),
            str_field(e, "name"),
            format_ms(num(e, "duration_ms")),
            if str_field(e, "outcome") == "error" {
                "ERROR"
            } else {
                ""
            },
        );
    }
    Ok(())
}
