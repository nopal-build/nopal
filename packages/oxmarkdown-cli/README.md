# oxmarkdown-cli

A plain terminal command for OxMarkdown tooling — parse/format/lint/
inspect — built directly on [`oxmarkdown-core`](../oxmarkdown-core).

## Why a script, not an MCP server or a `nopal` subcommand

Two alternatives were considered and rejected:

- **An MCP server** — built once, then removed. MCP tool schemas get
  sent to the model as part of the request context on every turn a
  server is connected, whether or not a tool is ever called — a standing
  token cost with no capability an agent with terminal access doesn't
  already have via a plain script like this one. MCP earns its keep for
  clients with no shell at all; that's not the situation here.
- **A `nopal markdown ...` subcommand on the Rust CLI** (`crates/cli`) —
  `oxmarkdown-core`'s parser is TypeScript (mdast/micromark, plus a
  custom `==highlight==` extension); porting it to Rust would risk a
  second implementation drifting from the JS parser that's the actual
  source of truth for rendering. Having the distributed Rust binary
  shell out to Node isn't viable either — unlike the small standalone
  binaries it already shells out to (`ffmpeg`, `tesseract`), running
  `oxmarkdown-core` needs this whole pnpm workspace's `node_modules`,
  which only exists inside a nopal repo checkout.

So: a plain script, same `vite-node`-run convention as `packages/worker`
and `webapp/scripts/*` — callable on demand from any terminal-capable
agent or engineer already working inside this checkout, at zero cost
until it's actually invoked.

## Usage

```sh
pnpm --dir packages/oxmarkdown-cli start -- <command> [path] [--flags]
```

`path` may be a real file, or `-`/omitted to read stdin — every command
composes with ordinary shell piping.

| Command | Description |
| --- | --- |
| `parse <path\|-> [--positions]` | Parse to mdast JSON |
| `format <path\|-> [--write]` | Normalize markdown formatting |
| `directives <path\|->` | List `:name{...}` directives as JSON |
| `mentions <path\|->` | List `@mentions` as JSON |
| `lint <path\|->` | Heuristic structural checks (JSON); exits 1 if any issue is an error |
| `ref --name= --datetime= --location= [--human-id=] [--verbose]` | Build a `:ref{...}` directive |
| `card-add <path\|-> --file= --project-folder-id= [--write]` | Append a `::card{...}` directive |
| `card-remove <path\|-> --file= [--write]` | Remove a `::card{...}` directive |

### Examples

```sh
# Lint a file, fail the shell if there's a real error
pnpm --dir packages/oxmarkdown-cli start -- lint some/file.md

# Normalize formatting in place
pnpm --dir packages/oxmarkdown-cli start -- format some/file.md --write

# Pipe markdown in, inspect its directives
cat some/file.md | pnpm --dir packages/oxmarkdown-cli start -- directives -

# Build a citation directive
pnpm --dir packages/oxmarkdown-cli start -- ref \
  --name="Ana" --datetime="2026-01-01T00:00:00Z" --location="/vault/x"
```

## Extending

Add new logic to `src/tools.ts` (pure functions against `oxmarkdown-core`
— no CLI-specific code), then wire up a new `case` in `src/cli.ts`'s
`main()`. Keep the split: `tools.ts` stays trivially unit-testable
without any argv/stdio concerns.
