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
