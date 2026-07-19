import { Component } from 'react'

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
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('[ui] render error:', error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="crash" role="alert">
        <div className="crash__card">
          <span className="crash__icon" aria-hidden="true">⚠️</span>
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
        </div>
      </div>
    )
  }
}
