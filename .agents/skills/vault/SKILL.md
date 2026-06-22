---
name: vault
description: Nopal Vault
disable-model-invocation: false
---

The vault is where a human (user) goes to find their files. They can upload their own files or they will be created by our app. Files created by our app take on a certain markdown structure that enables us to connect files together.

The vault terminology:
- Card: Markdown file
- File Tree: a hierarchical view of the vault's files
- Folder view: How we display the contents of the folder.
- File view: How we display the contents of a file.

Folder & File Sharing:
- Folders can be shared with other humans (users).
  - All files and sub-folders will be shared. Any new file added to that root shared folder will all include the same permissions.
- Markdown files can be public. The public view on the nopal website with the normal head and footer of the public site.
- Files can be shared in one of 3 types within the vault.
  - View only
  - Workable
  - Editable
  - These corrispond to the @mdx-editor

URL: /fruits/vault

Daily Logs
Daily logs are stored in the vault, so even though they have a specific page, they still end up in the vault, meaning we should treat the daily logs like any other file in the vault.
