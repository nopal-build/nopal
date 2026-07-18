---
name: mdx-editor
description: Definition for MdxEditor
disable-model-invocation: false
---

The MdxEditor (MdxRenderer, MdxEditorView, MdxEditorClient, MdxEditorWorkable, MdxEditorEditable and mdxeditor.css) is a markdown editor geared towards nopal specific things.

Viewing only means it is static.
Workable means tasks and references can be mutated but nothing else.
Editable meants it is fully open to edit.

The goal with this editor is to create links to dynamic types of content. For example we can reference CSV file key/value pairs and display their content.

So when I mention MdxEditor make sure to check all files and make sure to update them in equal parts when it matters.

The editor will always save to markdown, however from that markdown we will interpert it and display it as a rich, interactive document.

## Generic directives

`MdxRenderer` supports generic directives (`:name{attrs}` inline, `::name{attrs}` block, `:::name{attrs} ... :::` container) as the extension mechanism for typed/dynamic content — see `webapp/app/util/nopalDirectives.ts`. This is what CSV key/value references use now: `:csv-key{key="location"}`, not the old `[location]` bracket syntax (retired). Callers pass a `directives` registry prop (to `MdxEditorView`/`MdxRenderer`) mapping directive names to renderers; unregistered names render a visible "unknown directive" marker rather than vanishing. The Vault's project rollup view (`ProjectView.tsx`, see the `vault` skill) is the first real consumer, using leaf directives (`::csv-table`, `::gallery`, `::svg`) for block-level content.

This directive mechanism, along with further syntax changes (`@`-mentions replacing `[[wiki-links]]`, `/` slash commands) and a new visual/design language, is the seed of **OxMarkdown** — see the `oxmarkdown` skill for the full vision doc and open TODOs before starting any larger rewrite.
