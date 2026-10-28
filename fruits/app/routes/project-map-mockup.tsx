// app/routes/project-map-mockup.tsx
//
// Public, no-auth mockup route for `garden/1-seeds/project-map.md`'s
// Basecamp/Camps navigation idea — see `ProjectMapMockup` for the real
// content. Deliberately NOT gated behind a loader/session: this is a
// throwaway design exploration with hardcoded data, not a real project
// view, so there's nothing here worth protecting.
import type { MetaFunction } from "react-router";
import { AuthShell } from "../components/AuthShell";
import { ProjectMapMockup } from "../components/project-map-mockup/ProjectMapMockup";

export const meta: MetaFunction = () => [{ title: "O.No · Project Map mockup" }];

export default function ProjectMapMockupRoute() {
  return (
    <AuthShell maxWidth="1100px">
      <ProjectMapMockup />
    </AuthShell>
  );
}
