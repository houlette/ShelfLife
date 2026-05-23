import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

type Tab = 'login' | 'register'

export function ViewLogin() {
  const { login } = useAuth()
  const [tab, setTab] = useState<Tab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      let token: string
      if (tab === 'login') {
        const res = await api.auth.login(email, password)
        token = res.access_token
      } else {
        const res = await api.auth.register(email, password, inviteCode)
        token = res.access_token
      }
      // Fetch user profile
      const tmpStore = localStorage.getItem('shelflife_token')
      localStorage.setItem('shelflife_token', token)
      const user = await api.auth.me().catch(() => null)
      if (tmpStore === null) localStorage.removeItem('shelflife_token')

      if (!user) throw new Error('Failed to load user profile')
      login(token, user)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 380, padding: '40px 36px', background: 'var(--paper)',
        border: '1px solid var(--line)', borderRadius: 4,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'flex', gap: 2, height: 16, justifyContent: 'center', marginBottom: 10, alignItems: 'flex-end' }}>
            {[
              { h: 14, c: 'var(--accent)', w: 4 },
              { h: 10, c: 'var(--accent-3)', w: 3 },
              { h: 16, c: 'var(--accent-2)', w: 5 },
              { h: 9, c: 'var(--hi)', w: 3 },
              { h: 13, c: 'var(--accent)', w: 4 },
            ].map((s, i) => (
              <div key={i} style={{ width: s.w, height: s.h, background: s.c, opacity: 0.85 }} />
            ))}
          </div>
          <div className="serif" style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.02em', fontWeight: 600 }}>
            ShelfLife
          </div>
          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontStyle: 'italic' }}>
            a reader's almanac
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid var(--line)' }}>
          {(['login', 'register'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null) }} style={{
              flex: 1, padding: '8px 0', border: 'none', background: 'transparent',
              fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              color: tab === t ? 'var(--ink)' : 'var(--muted)',
              fontWeight: tab === t ? 500 : 400,
              borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
              marginBottom: -1,
            }}>
              {t === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Email</div>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus
              style={{
                width: '100%', padding: '8px 10px', fontFamily: 'inherit', fontSize: 13,
                border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg)',
                color: 'var(--ink)', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Password</div>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '8px 10px', fontFamily: 'inherit', fontSize: 13,
                border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg)',
                color: 'var(--ink)', boxSizing: 'border-box',
              }}
            />
          </div>
          {tab === 'register' && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Invite code</div>
              <input
                type="text" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
                required placeholder="Paste invite code here"
                style={{
                  width: '100%', padding: '8px 10px', fontFamily: 'inherit', fontSize: 13,
                  border: '1px solid var(--line)', borderRadius: 2, background: 'var(--bg)',
                  color: 'var(--ink)', boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--m2)', background: 'var(--m2-bg, #fff0f0)', padding: '8px 10px', borderRadius: 2 }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={busy} style={{
            padding: '10px', fontFamily: 'inherit', fontSize: 13,
            background: 'var(--ink)', color: 'var(--paper)',
            border: 'none', borderRadius: 2, cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.7 : 1, marginTop: 4,
          }}>
            {busy ? 'Please wait…' : tab === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
