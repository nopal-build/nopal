/**
 * Lets `editingNodes.tsx` mount a full, independent `<OxEditor>` (for a
 * `::file{...}` directive's caption — see that file's header) WITHOUT
 * importing `components/OxEditor.tsx` directly, which would be circular:
 * `OxEditor.tsx` already imports `OxDirectiveNode`/`OxOpaqueNode` FROM
 * `editingNodes.tsx`. This neutral file breaks the cycle by inverting the
 * dependency — `OxEditor.tsx` provides itself as this context's value (a
 * real runtime import of only THIS file, not the reverse), and
 * `editingNodes.tsx` consumes it (also only importing THIS file). Only
 * `OxEditorProps` is imported from `OxEditor.tsx` here, and only as a
 * TYPE (`import type`, erased at compile time) — never a real runtime
 * reference back to that module.
 */

import { createContext, type ComponentType } from "react";
import type { OxEditorProps } from "../components/OxEditor";

export const OxEditorContext = createContext<ComponentType<OxEditorProps> | null>(null);
