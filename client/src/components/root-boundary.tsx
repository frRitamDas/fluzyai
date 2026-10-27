import { Component, type ReactNode } from 'react'

/**
 * The outermost boundary, above every provider.
 *
 * The route-level ErrorBoundary in components/error-boundary.tsx catches a page
 * that throws, but it lives *inside* the providers — a throw in App() itself
 * (a hook used outside its provider, a provider that fails to initialise) has
 * nobody to catch it, so React unmounts the tree and the browser paints the
 * page background and nothing else. That is indistinguishable from a site that
 * is down: a production release shipped exactly that way for an afternoon.
 *
 * Deliberately dependency-free: no router, no i18n, no context, no CSS classes
 * that need a provider. Plain inline styles survive a broken stylesheet too.
 */
interface RootBoundaryState {
  error: Error | null
}

export class RootBoundary extends Component<{ children: ReactNode }, RootBoundaryState> {
  state: RootBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RootBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[dashboard] the app failed to start:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#e6e6e6',
          background: '#0b0b0c',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Fluzy AI could not start</h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.75, lineHeight: 1.6 }}>
            The dashboard hit an error before it could draw anything. Reloading usually clears it; if it keeps
            happening, the details below are what to report.
          </p>
          <pre
            style={{
              margin: '1rem 0 0',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              background: 'rgba(255,255,255,0.06)',
              fontSize: '0.75rem',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {error.message || String(error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1.25rem',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(255,255,255,0.1)',
              color: 'inherit',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
