import { useEffect, useState } from 'react'

/** Workplace & leadership quotes for the auth brand panel. Kept short so the
 *  blockquote never reflows the panel by more than a line. The first entry is
 *  the one the page always opened with, so the initial paint is unchanged. */
const QUOTES = [
  { text: 'Take care of your employees and they’ll take care of your business.', author: 'Richard Branson' },
  { text: 'Alone we can do so little; together we can do so much.', author: 'Helen Keller' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Great things in business are never done by one person; they’re done by a team of people.', author: 'Steve Jobs' },
  { text: 'Talent wins games, but teamwork and intelligence win championships.', author: 'Michael Jordan' },
  { text: 'The strength of the team is each individual member. The strength of each member is the team.', author: 'Phil Jackson' },
  { text: 'Coming together is a beginning, staying together is progress, and working together is success.', author: 'Henry Ford' },
  { text: 'It always seems impossible until it’s done.', author: 'Nelson Mandela' },
  { text: 'Culture eats strategy for breakfast.', author: 'Peter Drucker' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Believe you can and you’re halfway there.', author: 'Theodore Roosevelt' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Aristotle' },
]

/**
 * The brand-panel quote, advancing on a timer (default 10s). Same markup and
 * classes as the static blockquote it replaces; the key remount replays the
 * fade animation on every change (see .brand__quote--fade in Auth.css).
 */
export default function RotatingQuote({ intervalMs = 10000 }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % QUOTES.length), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  const quote = QUOTES[index]
  return (
    <blockquote className="brand__quote brand__quote--fade" key={index}>
      <p>&ldquo;{quote.text}&rdquo;</p>
      <cite>{quote.author}</cite>
    </blockquote>
  )
}
