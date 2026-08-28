//! `nopal sync-api ...` — manual create/inspect/append commands for
//! `sync-api` analyses, useful for setting one up or testing it by hand.
//! The main integration point (the `record-load-cell` command) calls
//! `nopal_core::sync_api` directly rather than shelling out to these — see
//! the vault skill's "Sync types" section.

use std::error::Error;

use nopal_core::sync_api::{self, SyncApiSchema};
use nopal_core::vault::Client;

pub fn create_analysis(
    name: &str,
    project: Option<String>,
    schema: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let schema: SyncApiSchema = sync_api::parse_schema_spec(schema)?;
    let folder = sync_api::ensure_analysis(&client, project.as_deref(), name, &schema)?;
    println!("Analysis ready: {} ({})", folder.name, folder._id);
    for col in &schema.columns {
        println!("  {}: {}", col.name, col.column_type);
    }
    Ok(())
}

pub fn create_run(
    analysis_name: &str,
    project: Option<String>,
    name: Option<String>,
    prefix: Option<String>,
    title: Option<String>,
    body: Option<String>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let analysis = sync_api::resolve_analysis(&client, project.as_deref(), analysis_name)?;
    let run = sync_api::create_run(
        &client,
        &analysis,
        name.as_deref(),
        prefix.as_deref(),
        title.as_deref(),
        body.as_deref(),
    )?;
    println!(
        "Created run '{}' — {}.md ({}) / {}.csv ({})",
        run.name, run.name, run.md_file_id, run.name, run.csv_file_id
    );
    Ok(())
}

pub fn append_row(
    analysis_name: &str,
    run_name: &str,
    project: Option<String>,
    row: &str,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let analysis = sync_api::resolve_analysis(&client, project.as_deref(), analysis_name)?;
    let row = sync_api::parse_row_spec(row)?;
    let appended = sync_api::append_rows(&client, &analysis, run_name, &[row])?;
    println!("Appended {appended} row(s) to '{run_name}'.");
    Ok(())
}

pub fn ls_runs(
    analysis_name: &str,
    project: Option<String>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let client = Client::new()?;
    let analysis = sync_api::resolve_analysis(&client, project.as_deref(), analysis_name)?;
    let runs = sync_api::list_runs(&client, &analysis)?;
    if runs.is_empty() {
        println!("No runs yet in '{analysis_name}'.");
        return Ok(());
    }
    for run in runs {
        println!("{}", run.name);
    }
    Ok(())
}
