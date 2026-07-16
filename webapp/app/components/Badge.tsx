// app/components/Badge.tsx

type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "accent";

type BadgeProps = {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
};

/**
 * Semantic status pill (Complete, Overdue, Invited, …). Variant colors live
 * in root.css (`.badge-*`) so the neutral variant can flip for dark mode —
 * don't hand-roll pill spans with inline `--farground`/`--midground` colors,
 * they won't flip (see the status pills in `RelationshipCard` for usage).
 */
export function Badge({
  variant = "neutral",
  children,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`badge-${variant} text-xs px-2 py-0.5 rounded-full font-mono shrink-0 ${className}`.trim()}
    >
      {children}
    </span>
  );
}
