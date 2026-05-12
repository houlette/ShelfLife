import { SectionTitle } from '../components'

type Theme = 'paper' | 'midnight' | 'clinic'

interface Props {
  theme: Theme
  setTheme: (t: Theme) => void
}

export function ViewSettings({ theme, setTheme }: Props) {
  return (
    <div>
      <SectionTitle no="01">Settings</SectionTitle>

      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Theme</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['paper', 'midnight', 'clinic'] as Theme[]).map(t => (
            <button key={t} onClick={() => setTheme(t)} style={{
              padding: '10px 20px', fontSize: 13, borderRadius: 4, cursor: 'pointer',
              fontFamily: 'inherit',
              background: theme === t ? 'var(--ink)' : 'var(--paper)',
              color: theme === t ? 'var(--paper)' : 'var(--ink-soft)',
              border: '1px solid ' + (theme === t ? 'var(--ink)' : 'var(--line)'),
            }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 480 }}>
        <strong style={{ color: 'var(--ink)' }}>ShelfLife</strong> is a local-first reading analytics dashboard.
        Your data stays on your machine in a SQLite database. No data is sent anywhere except to Claude
        for the AI Insights feature (which requires an Anthropic API key).
      </div>
    </div>
  )
}
