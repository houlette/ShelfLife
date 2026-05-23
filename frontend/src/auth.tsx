import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface AuthUser {
  id: number
  email: string
  display_name: string
  is_admin: boolean
}

interface AuthCtx {
  user: AuthUser | null
  token: string | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

const TOKEN_KEY = 'shelflife_token'
const USER_KEY  = 'shelflife_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user,  setUser]  = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  })

  const login = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  return <Ctx.Provider value={{ user, token, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
