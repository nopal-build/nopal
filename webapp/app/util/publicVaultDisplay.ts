/**
 * Small, pure display helpers shared by the /public/* (unauthenticated)
 * vault-browsing routes. No server-only imports — safe on client too.
 */

export function fileIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼️";
  if (contentType === "application/pdf") return "📄";
  if (contentType === "text/markdown") return "📝";
  if (contentType === "text/csv") return "📊";
  if (contentType.startsWith("video/")) return "🎬";
  return "📎";
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  // Parse the calendar date directly from the ISO string so server (UTC)
  // and browser (local timezone) always produce the same string and React
  // hydration stays in sync.
  const [datePart] = iso.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function isMarkdownFile(file: {
  name: string;
  content_type: string;
}): boolean {
  return (
    file.content_type === "text/markdown" ||
    file.name.toLowerCase().endsWith(".md")
  );
}
