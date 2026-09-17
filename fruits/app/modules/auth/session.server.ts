// Re-export shim -- the real implementation lives in robustness-core,
// shared with any other future app on this workspace (e.g. webapp used to
// re-export this too, before login moved here entirely -- see
// docs/marketing-app-split-plan.md, Phase 3).
export * from "robustness-core/auth/session.server";
