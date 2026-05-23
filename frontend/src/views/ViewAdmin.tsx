import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'

export function ViewAdmin() {
  const { user } = useAuth()
  const [generating, setGenerating] = useState(false)
  const [newCode, setNewCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: invites = [], refetch } = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.auth.listInvites(),
    enabled: user?.is_admin === true,
  })

  async function generateInvite() {
    setGenerating(true)
    setNewCode(null)
    try {
      const res = await api.auth.createInvite()
      setNewCode(res.code)
      refetch()
    } finally {
      setGenerating(false)
    }
  }

  async function copyCode() {
    if (!newCode) return
    await navigator.clipboard.writeText(newCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!user?.is_admin) {
    return <div style={{ color: 'var(--muted)', fontSize: 13 }}>Admin access required.</div>
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2 className="serif" style={{ fontSize: 22, marginBottom: 4, fontWeight: 600 }}>Admin</h2>
      <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 32 }}>Manage invite codes for new users.</div>

      {/* Generate invite */}
      <div style={{ marginBottom: 32 }}>
        <button onClick={generateInvite} disabled={generating} style={{
          padding: '9px 18px', fontFamily: 'inherit', fontSize: 13,
          background: 'var(--ink)', color: 'var(--paper)',
          border: 'none', borderRadius: 2, cursor: 'pointer',
        }}>
          {generating ? 'Generating…' : 'Generate invite link'}
        </button>

        {newCode && (
          <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 2 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>New invite code</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all', color: 'var(--ink)' }}>{newCode}</code>
              <button onClick={copyCode} style={{
                padding: '5px 10px', fontFamily: 'inherit', fontSize: 11,
                background: copied ? 'var(--g1)' : 'transparent',
                color: copied ? '#fff' : 'var(--muted)',
                border: '1px solid var(--line)', borderRadius: 2, cursor: 'pointer', flexShrink: 0,
              }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              Share this code with the person you're inviting. Each code can only be used once.
            </div>
          </div>
        )}
      </div>

      {/* Invite list */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>All invite codes</div>
        {invites.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No invite codes yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Code', 'Status', 'Used at'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--muted)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                  <td style={{ padding: '7px 8px', fontFamily: 'monospace', fontSize: 11, color: 'var(--ink-soft)', wordBreak: 'break-all' }}>
                    {inv.code.slice(0, 16)}…
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: 10, fontSize: 11,
                      background: inv.used ? 'var(--m1-bg, #f0f4f0)' : 'var(--hi-bg, #fffce8)',
                      color: inv.used ? 'var(--muted)' : 'var(--ink)',
                    }}>
                      {inv.used ? 'Used' : 'Unused'}
                    </span>
                  </td>
                  <td style={{ padding: '7px 8px', color: 'var(--muted)' }}>
                    {inv.used_at ? new Date(inv.used_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
