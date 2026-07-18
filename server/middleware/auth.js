import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../env.js'
import { User } from '../models/User.js'

/**
 * Verify the Bearer JWT and attach the current user to req.user.
 * This is the backbone of backend-enforced RBAC: every protected route
 * runs through here, so access can never be bypassed from the UI.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) return res.status(401).json({ error: 'Not authenticated.' })

    const payload = jwt.verify(token, JWT_SECRET)
    const user = await User.findById(payload.sub)
    if (!user) return res.status(401).json({ error: 'Session no longer valid.' })

    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' })
  }
}

/** Restrict a route to specific roles. Use after requireAuth. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' })
    }
    next()
  }
}
