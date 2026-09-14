// TEMPORARY re-export shim. The real implementation moved to
// robustness-core (shared with the future app service at o.nopal.build --
// see docs/marketing-app-split-plan.md, Phase 2) so every existing
// `../modules/auth/session.server` import in webapp/app keeps working
// unchanged for now.
//
// Login/sessions are moving ENTIRELY to o.nopal.build (see the plan's
// resolved open questions -- the marketing site itself never needs any
// session information). Once that move happens (Phase 3+), this file and
// the rest of webapp/app/modules/auth/ should be deleted outright, not
// kept as a shim.
export * from "robustness-core/auth/session.server";
