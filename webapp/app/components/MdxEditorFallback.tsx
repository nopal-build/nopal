/**
 * MdxEditorFallback — shared loading and error fallbacks for lazy-loaded
 * MdxEditor components.
 *
 * EditorLoadingFallback — a sized placeholder that matches the editor's
 *   minimum height so the page doesn't shift when the editor finishes loading.
 *
 * EditorErrorBoundary — a class-based React error boundary that catches
 *   render/lazy-load failures and shows a gentle inline error message.
 */

import React from "react";

// ── Loading placeholder ────────────────────────────────────────────────────

export function EditorLoadingFallback({
  hasTray = true,
}: {
  hasTray?: boolean;
}) {
  return (
    <div className="mdx-editor-loading">
      <div className="mdx-editor-loading-content" />
      {hasTray && <div className="mdx-editor-loading-tray" />}
    </div>
  );
}

// ── Error boundary ─────────────────────────────────────────────────────────

interface EditorErrorBoundaryState {
  hasError: boolean;
}

export class EditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  EditorErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): EditorErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mdx-editor-error">
          <div className="mdx-editor-error-content">
            <p className="mdx-editor-error-title">Editor couldn’t load</p>
            <p className="mdx-editor-error-hint">Try refreshing the page</p>
          </div>
          <div className="mdx-editor-error-tray" />
        </div>
      );
    }

    return this.props.children;
  }
}
