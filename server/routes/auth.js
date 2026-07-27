import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET, JWT_EXPIRES_IN } from '../env.js'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  })
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 * One login endpoint for every role — the frontend routes to the right
 * dashboard based on the role returned on `user`.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' })
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() })
    // Same generic message whether the email or password is wrong.
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    return res.json({ token: signToken(user), user: user.toSafeJSON() })
  } catch (err) {
    console.error('[auth/login]', err)
    return res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

/** GET /api/auth/me — resolve the current user from the token (session check). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeJSON() })
})

export default router
