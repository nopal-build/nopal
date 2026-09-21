/**
 * Minimal recursive mdast walker — visits every node (including the root)
 * depth-first. No `unist-util-visit` dependency: mdast nodes are plain
 * `{ type, children?, ... }` objects, so a generic child-array walk is all
 * the read-only inspection tools in this package need.
 */
export function walk(node: unknown, visit: (node: any) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  const children = (node as { children?: unknown }).children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  }
}

/** Strips every `position` field recursively — mdast's own line/column
 * info is invaluable for lint/list tools (so they can point an agent at the
 * exact line) but triples the size of a raw-tree dump for anything just
 * inspecting structure. */
export function stripPositions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripPositions);
  if (node && typeof node === "object") {
    const { position, ...rest } = node as Record<string, unknown>;
    for (const key of Object.keys(rest)) {
      rest[key] = stripPositions(rest[key]);
    }
    return rest;
  }
  return node;
}
