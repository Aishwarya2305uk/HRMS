import { User } from '../models/User.js'

/**
 * Every user id from `userId` up to the top of the reporting tree, INCLUDING
 * userId itself. One walk answers two different questions depending on which
 * id is "self" and which is the id being looked up in the returned set:
 *
 *  - Does a 'team' broadcast rooted at X reach viewer V?
 *      ancestorChain(V).has(X)
 *  - Is target X within manager M's own downward reach (M is X or reports-of
 *    -reports up to X)?
 *      (await ancestorChain(X)).has(M)
 *
 * Walks upward via managerId rather than downward from a root because a
 * viewer's chain to the top is a single path, while a root's full descendant
 * set can fan out arbitrarily — cheaper to walk the short direction and ask
 * "is X in it?" than to materialize every descendant of X.
 */
export async function ancestorChain(userId) {
  const chain = new Set([String(userId)])
  let cursor = await User.findById(userId).select('managerId')
  while (cursor?.managerId) {
    const id = String(cursor.managerId)
    if (chain.has(id)) break // corrupt-data cycle guard — never trust stored data blindly
    chain.add(id)
    cursor = await User.findById(cursor.managerId).select('managerId')
  }
  return chain
}

/**
 * Every user id in `managerId`'s downward reporting subtree — their direct
 * and transitive reports, NOT including managerId itself. This is the
 * "who am I allowed to put in one of my own project teams" set (see
 * server/routes/teams.js): a team can only ever be built from people
 * already here, so it can never grant reach beyond the manager's existing
 * whole-subtree broadcast authority.
 *
 * Loads the whole roster and walks down in memory (same scale assumption as
 * the existing org-tree/audience-options endpoints — cheap at this
 * company size) rather than repeatedly querying one level at a time.
 */
export async function descendantIds(managerId) {
  const users = await User.find({}).select('_id managerId')
  const childrenOf = new Map()
  for (const u of users) {
    if (!u.managerId) continue
    const key = String(u.managerId)
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key).push(String(u._id))
  }

  const result = []
  const seen = new Set([String(managerId)])
  const queue = [...(childrenOf.get(String(managerId)) ?? [])]
  for (const id of queue) seen.add(id)
  while (queue.length) {
    const id = queue.shift()
    result.push(id)
    for (const childId of childrenOf.get(id) ?? []) {
      if (!seen.has(childId)) {
        seen.add(childId)
        queue.push(childId)
      }
    }
  }
  return result
}
