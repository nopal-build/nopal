# oxmarkdown-rs

Phase 0 of `ono` (see `../../README.md`): can OxMarkdown's actual syntax
be parsed in Rust at all?

## Approach: unmodified `markdown-rs`, plus a fence-tracking pre-pass — not a fork

`markdown-rs` (crate `markdown`) is the Rust sibling of the JS
`micromark`/`mdast` ecosystem OxMarkdown is built on (same author), with
real CommonMark + GFM + frontmatter parity. It does not support generic
directives (`:name{}`/`::name{}`/`:::name{}`) and has no plugin system to
add them from outside — confirmed via its own open upstream issue
(`wooorm/markdown-rs#57`), where the maintainer says they'd welcome a
contribution but have no timeline themselves.

Forking `markdown-rs` to add directives as a real internal construct was
considered and rejected: it would mean permanently maintaining a diff
against every future upstream release. Instead, `directives.rs`
implements directives as a **pre-pass over the raw text**, ahead of
handing plain markdown to unmodified `markdown-rs`:

- Directives are fence-delimited (`::name{}` occupies its own line;
  `:::name{}` ... `:::` brackets a region) — structurally in the same
  family as fenced code blocks and frontmatter (both real, simple,
  self-contained `markdown-rs` constructs already), NOT in the family of
  lists/blockquotes, which need complex interruption rules because they
  have no explicit closing marker. That's what makes a correct pre-pass
  possible here without reimplementing CommonMark's own container logic.
- A stack-based scanner walks the raw text line by line, tracking fenced
  code blocks/frontmatter (so directive-looking text inside either is
  never misread) and container-directive nesting depth, splitting the
  document into plain-markdown chunks (fed to `markdown::to_mdast`
  unmodified) and directive regions. A container directive's body is
  recursively re-parsed through the same function — giving real nested
  directive support for free.
- Output is a `serde_json::Value` tree shaped like the JS
  implementation's mdast-plus-directives tree (`oxmarkdown-core`'s
  `document.ts`) — same `type`/`name`/`attributes`/`children` — so it can
  be diffed directly against the real JS parser's output in tests.

If this eventually gets clean enough (and there's real appetite), the
upstream issue is the actual off-ramp: contribute directives into
`markdown-rs` itself and drop this pre-pass entirely, rather than
maintaining it forever.

## Status

- **Done**: block-level directives (leaf `::name{}`, container
  `:::name{}` ... `:::`, including nesting and — the case that actually
  matters — a container body spanning a blank line, the exact thing the
  old regex-based `nopalDirectives.ts`/`nopalEditorState.ts` era couldn't
  handle). Validated two ways: hand-written fixtures
  (`src/directives.rs`'s own tests) and the REAL playground sample from
  `fruits/app/routes/styles_.oxmarkdown.tsx`'s `DEFAULT_SAMPLE`, copied
  verbatim into `tests/real_playground_sample.rs`.
- **Not started**: inline constructs — text directives (`:name{}`, e.g.
  `:ref{...}`) and the custom `==highlight==` mark. Both need an
  analogous pre-pass at the INLINE level (protecting placeholder spans
  from interacting with emphasis/link/code-span delimiters, most likely
  via inert Unicode private-use-area sentinels), not yet built.
  `tests/real_playground_sample.rs`'s
  `known_gap_inline_text_directives_not_yet_extracted` documents this
  honestly rather than silently having no coverage of it.
- **Known, deliberate limitation**: a directive fence is only recognized
  at the top level of a line (0-3 leading spaces — the same block-starter
  leniency the JS implementation's `BLOCK_STARTER_LINE_RE` uses). A
  directive written *inside* a blockquote or list item isn't specifically
  handled. Real OxMarkdown content writes directives as their own
  top-level blocks in practice; revisit if that stops being true.
- **Done**: serializing back to markdown (`serialize_document`),
  mirroring the JS `serializeOxDocument`'s default (non-Editing-mode)
  behavior — one blank line between top-level blocks, not preserving
  every extra blank line exactly. Validated by round-tripping (parse ->
  serialize -> parse again -> compare trees, ignoring `position`) every
  fixture in this crate's tests, including the full real playground
  sample. Not yet validated for byte-for-byte agreement against the JS
  serializer's own output — only that this crate's own parse/serialize
  are consistent with each other.
- Consumed by `oxmarkdown-web` (`../oxmarkdown-web`), which now uses
  both `parse_document` and `serialize_document` together for a real
  interaction: clicking a task checkbox mutates the AST and saves
  through the real markdown round trip, not a visual-only toggle.

## Running the tests

```sh
cargo test
```

From `ono/` (the workspace root) or from this crate's own directory.
