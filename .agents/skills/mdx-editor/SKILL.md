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
