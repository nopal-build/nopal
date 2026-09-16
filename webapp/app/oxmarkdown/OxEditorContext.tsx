/**
 * TRIMMED duplicate of fruits/app/oxmarkdown/OxEditorContext.tsx -- webapp
 * has no `OxEditor` component at all (editing is app-only, see
 * webapp/app/components/OxRenderer.tsx's own comment), so this context's
 * value type is just `ComponentType<any>` instead of importing a real
 * `OxEditorProps` shape from a module that doesn't exist here. Always
 * `null` in practice for every marketing route (none of them render an
 * editable nested card) -- this exists purely so `OxRenderer.tsx` (an
 * otherwise-verbatim duplicate) compiles unmodified. Not shared; keep
 * both in sync by hand.
 */

import { createContext, type ComponentType } from "react";

export const OxEditorContext = createContext<ComponentType<any> | null>(null);
