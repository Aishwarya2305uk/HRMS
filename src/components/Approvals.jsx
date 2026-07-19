import { useState } from 'react'
import Icon from './Icon'
import { leaves as leavesApi } from '../lib/hrms'
import { haptic } from '../lib/haptics'
import { formatRange } from '../lib/format'

/**
 * Manager approval queue — pending leaves from DIRECT REPORTS only (the server
 * enforces this; the UI just renders what it returns). Approve deducts the
 * employee's balance; reject can carry a short comment.
 *
 * @param {Array}          props.pending    from /leaves/pending
 * @param {object}         props.typeLabels { key: label }
 * @param {(id)=>void}     props.onDecided  remove the row after a decision
 */
export default function Approvals({ pending, typeLabels, onDecided }) {
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(null) // leave id being rejected
  const [comment, setComment] = useState('')

  async function approve(id) {
    setBusyId(id)
    setError('')
    haptic('success')
    try {
      await leavesApi.approve(id)
      onDecided(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function confirmReject(id) {
    setBusyId(id)
    setError('')
    haptic('warning')
    try {
      await leavesApi.reject(id, comment)
      setRejecting(null)
      setComment('')
      onDecided(id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card approvals pop" style={{ '--d': '260ms' }}>
      <div className="attendance__head">
        <h2>Pending approvals</h2>
        <span className="count-pill">{pending.length}</span>
      </div>

      {error && (
        <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>
          <span aria-hidden="true">⚠️</span>
          {error}
        </div>
      )}

      {pending.length === 0 ? (
        <p className="empty">You're all caught up — no requests waiting.</p>
      ) : (
        <ul className="approval-list">
          {pending.map((l) => (
            <li key={l.id} className="approval">
              <div className="approval__main">
                <div className="approval__who">
                  <span className="avatar sm" aria-hidden="true">{l.employeeName?.[0] ?? '?'}</span>
                  <div>
                    <strong>{l.employeeName}</strong>
                    <em>
                      {typeLabels[l.type] ?? l.type} · {formatRange(l.startDate, l.endDate)} ·{' '}
                      {l.days} {l.days > 1 ? 'days' : 'day'}
                    </em>
                  </div>
                </div>
                {l.reason && <p className="approval__reason">“{l.reason}”</p>}
              </div>

              {rejecting === l.id ? (
                <div className="approval__reject">
                  <input
                    type="text"
                    placeholder="Reason (optional)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    autoFocus
                  />
                  <button className="btn-tactile danger sm" disabled={busyId === l.id} onClick={() => confirmReject(l.id)}>
                    Confirm
                  </button>
                  <button className="btn-tactile ghost sm" onClick={() => { setRejecting(null); setComment('') }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="approval__actions">
                  <button className="btn-tactile primary sm" disabled={busyId === l.id} onClick={() => approve(l.id)}>
                    <Icon name="check" size={16} /> Approve
                  </button>
                  <button className="btn-tactile ghost sm" disabled={busyId === l.id} onClick={() => setRejecting(l.id)}>
                    Reject
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
