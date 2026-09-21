#!/usr/bin/env -S vite-node
/**
 * A plain terminal command for OxMarkdown tooling (parse/format/lint/
 * inspect), built directly on `oxmarkdown-core`. Run inside this repo
 * checkout via `pnpm --dir packages/oxmarkdown-cli start -- <command>
 * [path] [--flags]` — see README.md.
 *
 * Deliberately NOT an MCP server and NOT a `nopal` (Rust CLI) subcommand:
 * see this package's README for why — the short version is that MCP's
 * standing per-turn tool-schema cost and a Rust reimplementation's
 * drift risk both lose to "just a script any terminal-capable agent can
 * invoke on demand, at zero cost until it's actually run."
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildRefDirective,
  formatMarkdown,
  insertCardDirective,
  lintMarkdown,
  listDirectives,
  listMentions,
  parseMarkdown,
  removeCardDirective,
} from "./tools";

type Flags = Map<string, string | true>;

function parseArgs(argv: string[]): { command?: string; path?: string; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = new Map();
  let path: string | undefined;
  for (const arg of rest) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) {
      flags.set(match[1], match[2]);
    } else if (arg.startsWith("--")) {
      flags.set(arg.slice(2), true);
    } else if (path === undefined) {
      path = arg;
    }
  }
  return { command, path, flags };
}

function readInput(path: string | undefined): string {
  // "-" or an omitted path both mean stdin — fd 0, read synchronously,
  // same idiom `pull-daily-logs.ts`-style scripts in this repo already
  // avoid needing since they only ever read real files; this script is
  // the first that benefits from piping (`cat file.md | ... lint -`).
  if (!path || path === "-") return readFileSync(0, "utf-8");
  return readFileSync(path, "utf-8");
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** `--write` overwrites the input file in place (only meaningful for a
 * real file path, never stdin); otherwise the result goes to stdout so
 * it can be piped/redirected like any other Unix tool. */
function writeOutput(path: string | undefined, flags: Flags, content: string): void {
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  if (flags.get("write")) {
    if (!path || path === "-") {
      console.error("--write requires a real file path, not stdin");
      process.exit(1);
    }
    writeFileSync(path, content, "utf-8");
    console.error(`Wrote ${path}`);
    return;
  }
  process.stdout.write(normalized);
}

function requireFlag(flags: Flags, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string") {
    console.error(`Missing required flag --${name}=`);
    process.exit(1);
  }
  return value;
}

function usage(): never {
  console.error(`Usage: oxmarkdown-cli <command> [path] [--flags]

Commands:
  parse <path|-> [--positions]         Parse to mdast JSON
  format <path|-> [--write]            Normalize markdown formatting
  directives <path|->                  List :name{...} directives as JSON
  mentions <path|->                    List @mentions as JSON
  lint <path|->                        Heuristic structural checks (JSON);
                                        exits 1 if any issue is an error
  ref --name= --datetime= --location= [--human-id=] [--verbose]
                                        Build a :ref{...} directive
  card-add <path|-> --file= --project-folder-id= [--write]
                                        Append a ::card{...} directive
  card-remove <path|-> --file= [--write]
                                        Remove a ::card{...} directive

"-" or an omitted path reads from stdin. Without --write, output always
goes to stdout, so every command composes with ordinary shell piping.`);
  process.exit(1);
}

function main(): void {
  const { command, path, flags } = parseArgs(process.argv.slice(2));
  if (!command) usage();

  switch (command) {
    case "parse":
      printJson(parseMarkdown(readInput(path), Boolean(flags.get("positions"))));
      return;

    case "format":
      writeOutput(path, flags, formatMarkdown(readInput(path)));
      return;

    case "directives":
      printJson(listDirectives(readInput(path)));
      return;

    case "mentions":
      printJson(listMentions(readInput(path)));
      return;

    case "lint": {
      const issues = lintMarkdown(readInput(path));
      printJson(issues);
      if (issues.some((issue) => issue.severity === "error")) process.exit(1);
      return;
    }

    case "ref": {
      const name = requireFlag(flags, "name");
      const datetime = requireFlag(flags, "datetime");
      const location = requireFlag(flags, "location");
      const humanId = flags.get("human-id");
      process.stdout.write(
        `${buildRefDirective({
          name,
          datetime,
          location,
          humanId: typeof humanId === "string" ? humanId : undefined,
          verbose: flags.get("verbose") === true,
        })}\n`,
      );
      return;
    }

    case "card-add": {
      const file = requireFlag(flags, "file");
      const projectFolderId = requireFlag(flags, "project-folder-id");
      writeOutput(
        path,
        flags,
        insertCardDirective(readInput(path), { file, projectFolderId }),
      );
      return;
    }

    case "card-remove": {
      const file = requireFlag(flags, "file");
      writeOutput(path, flags, removeCardDirective(readInput(path), file));
      return;
    }

    default:
      usage();
  }
}

main();
