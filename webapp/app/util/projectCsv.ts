/**
 * Project CSV helpers — shared between the Vault UI and the MDX editor.
 *
 * A project lives in the Vault under `projects/<project-name>/` and contains:
 *   • readme.md     — the top-level reference for the project
 *   • project.csv   — key/value facts (location, estimated cost, …)
 *
 * The CSV is a simple two-column `name,value` table. Values can be referenced
 * from the readme markdown with `[csv-name]` and edited inline in the editor.
 *
 * This file has NO server-only imports — safe on both client and server.
 */

export const PROJECTS_FOLDER_NAME = "projects";
export const PROJECT_CSV_NAME = "project.csv";
export const PROJECT_README_NAME = "readme.md";

export type CsvField = { key: string; value: string };

export function isCsvFileName(name: string, contentType?: string): boolean {
  return contentType === "text/csv" || name.toLowerCase().endsWith(".csv");
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/** Splits a single CSV line into cells, honoring double-quoted values. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parses a two-column `name,value` CSV into ordered fields.
 * A `name,value` header row (case-insensitive) is skipped if present.
 * Extra columns beyond the second are folded back into the value.
 */
export function parseCsvFields(content: string): CsvField[] {
  const fields: CsvField[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const cells = splitCsvLine(line);
    const key = (cells[0] ?? "").trim();
    if (!key) continue;
    // Skip the header row
    if (
      i === 0 &&
      key.toLowerCase() === "name" &&
      (cells[1] ?? "").trim().toLowerCase() === "value"
    ) {
      continue;
    }
    const value = cells.slice(1).join(",").trim();
    fields.push({ key, value });
  }
  return fields;
}

// ── Serialization ────────────────────────────────────────────────────────────

function escapeCsvCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function serializeCsvFields(fields: CsvField[]): string {
  const lines = ["name,value"];
  for (const { key, value } of fields) {
    if (!key.trim()) continue;
    lines.push(`${escapeCsvCell(key.trim())},${escapeCsvCell(value)}`);
  }
  return lines.join("\n") + "\n";
}

export function csvFieldsToRecord(fields: CsvField[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, value } of fields) record[key] = value;
  return record;
}

// ── New-project templates ────────────────────────────────────────────────────

export function defaultProjectCsv(projectName: string): string {
  return serializeCsvFields([
    { key: "name", value: projectName },
    { key: "location", value: "" },
    { key: "estimated-cost", value: "" },
    { key: "start-date", value: "" },
    { key: "status", value: "planning" },
  ]);
}

export function defaultProjectReadme(projectName: string): string {
  return [
    `# ${projectName}`,
    "",
    "Located in [location] with an estimated cost of [estimated-cost].",
    "",
    "Current status: [status]",
    "",
    "## Notes",
    "",
  ].join("\n");
}
