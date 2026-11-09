// Every address in the letters workflow, in one place, so a page and the
// links that lead to it can't drift apart. Plain functions, safe on the
// client; `letters.server.ts` has its own `letterPublicPath` for the
// server's URLs (the page, the mailbox, the PDF) and the two must agree.
//
// The letter's own page: as its readers see it (`public.letter.$fileId.tsx`).
export function letterPublicPath(fileId: string): string {
  return `/public/letter/${fileId}`;
}

// The desk: the project's Letters tab, where letters are written and kept.
export function deskPath(projectFolderId: string): string {
  return `/newspaper/${projectFolderId}?tab=letters`;
}

// Where a letter is written: the desk in its project, a page of its own
// (`routes/newspaper.$folderId_.letter.$fileId.tsx`). Not the Vault.
export function letterDeskPath(projectFolderId: string, fileId: string): string {
  return `/newspaper/${projectFolderId}/letter/${fileId}`;
}

// The desk with the New letter form open, started from what the viewer
// said about the letter `fileId` ("Write a letter from this").
export function writeBackPath(projectFolderId: string, fileId: string): string {
  return `${deskPath(projectFolderId)}&from=${fileId}`;
}
