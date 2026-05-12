import { ratingColor } from '../utils'

interface Props {
  rating: number
  size?: number
  showNumber?: boolean
}

export function RatingStars({ rating, size = 14, showNumber = false }: Props) {
  if (!rating || rating === 0) {
    return <span style={{ fontSize: size * 0.8, color: 'var(--muted)' }}>unrated</span>
  }
  const color = ratingColor(rating)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20">
          <polygon
            points="10,1 12.5,7 19,7.5 14,12 15.5,19 10,15.5 4.5,19 6,12 1,7.5 7.5,7"
            fill={i <= rating ? color : 'var(--line)'}
            stroke="none"
          />
        </svg>
      ))}
      {showNumber && (
        <span className="num" style={{ fontSize: size * 0.75, color: 'var(--muted)', marginLeft: 4 }}>
          {rating}
        </span>
      )}
    </span>
  )
}
