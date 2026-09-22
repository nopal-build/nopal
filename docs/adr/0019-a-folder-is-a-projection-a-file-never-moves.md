# ADR-019 — A folder is a projection. A file never moves.

**Status:** Accepted, 2026-09-22

**Context.** Files attached to daily logs had no view of their own: they appeared inside the Efforts page's galleries or in the raw vault browser. The file folders guide (vault, 2026-09-22) asked for four folders (Gallery, Documents, Costs, Unsorted), a document kind judged by the model, and costs read out and held unconfirmed. The obvious build files things: a receipt gets moved into a Costs folder. That is how every physical filing system works, and it is wrong here, because a file's home is the daily-log Card it was attached to, with somebody's words around it, on a day. That is the record (ADR-001). The graph cites it, the page cites it, and a mark can sit on it. Move it and every one of those breaks; copy it and there are two.

**Decision.** A folder is a view rebuilt on every request from the record and the pipeline's outputs (`fileFolders.server.ts`). Nothing in that module writes. A row is keyed by the file's original id (the one the Card names, which survives a refile) and served by its synced copy's id (the one the graph cites and a collaborator can open). The kind is the model's reading from the filing record until a person files it otherwise, and a person's act is an entry in their name (a mark on the file), so a reclassification has an author and a date and reaches the graph; it is never a field set on the file. One file can be in two folders, because a photo of a receipt is a photo and a receipt, and a physical folder's forced choice is not one the record has to make.

**Why it looks removable.** A stored `folder` column would be simpler to query and faster to show, and moving a file into a folder is what everyone expects a file browser to do. A stored kind on the file row would save a join.

**How you'd know.** A photo that used to be in a gallery is gone from it after somebody filed it as a receipt. A citation on last week's page points at a file that is not there. A collaborator can see a file in Costs and gets a 403 opening it. Two rows for one photo.

**Test.** `fileFolders.test.ts`: the module's source contains no write call; a receipt photo is one row in two folders; a row is served by its copy and keyed by its original; the latest `file-as` act wins over the model's kind.
