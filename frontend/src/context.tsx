import { createContext } from 'react'

interface NavigationContextValue {
  navigateToAuthor: (author: string) => void
}

export const NavigationContext = createContext<NavigationContextValue>({
  navigateToAuthor: () => {},
})
