import { Component } from 'react'
import Icon from './Icon'

/**
 * Last line of defence: catches render-time crashes so a single broken
 * component shows a recoverable message instead of a blank white screen.
 *
 * UX principle — "help users recognise, diagnose and recover": we explain what
 * happened in plain language and give two ways out (retry, or go home). The
 * technical detail is logged to the console for developers, never shown to the
 * user (it can contain internal implementation details).
 */
export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, stack: '' }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error:', error, info)
    // Kept in state purely so the DEV build can show it on screen (below) —
    // production still shows only the plain-language message.
    this.setState({ stack: info?.componentStack ?? '' })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, stack: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <span className="crash__icon" aria-hidden="true">
            <Icon name="alertTriangle" size={34} />
          </span>
          <h1>Something went wrong</h1>
          <p>
            This part of the page didn&apos;t load correctly. It&apos;s not
            something you did — trying again usually fixes it.
          </p>
          <div className="crash__actions">
            <button className="btn-tactile primary" onClick={this.handleRetry}>
              Try again
            </button>
            <button
              className="btn-tactile ghost"
              onClick={() => window.location.assign('/')}
            >
              Back to sign in
            </button>
          </div>

          {/* DEV ONLY. Vite statically replaces import.meta.env.DEV with false
              in a production build, so this whole block is dropped from the
              bundle — a user can never see internals, but a developer no
              longer has to go digging in the console to find out what broke. */}
          {import.meta.env.DEV && this.state.error && (
            <details className="crash__debug" open>
              <summary>Developer detail (dev build only)</summary>
              <pre>
                {String(this.state.error?.stack || this.state.error)}
                {this.state.stack}
              </pre>
            </details>
          )}
        </div>
      </div>
    )
  }
}
