import { useContext } from 'react'
import { NavigationContext } from '../context'

interface Props {
  author: string | null | undefined
  style?: React.CSSProperties
}

/**
 * Renders an author name as a subtle clickable button that navigates to the
 * Books tab pre-filtered by that author. Inherits font-size and color from
 * its parent so it drops in wherever plain text already appears.
 */
export function AuthorLink({ author, style }: Props) {
  const { navigateToAuthor } = useContext(NavigationContext)

  if (!author) return null

  return (
    <button
      onClick={() => navigateToAuthor(author)}
      style={{
        background: 'none', border: 'none', padding: 0, margin: 0,
        cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 'inherit', color: 'inherit', lineHeight: 'inherit',
        textAlign: 'left', display: 'inline',
        ...style,
      }}
    >
      {author}
    </button>
  )
}
