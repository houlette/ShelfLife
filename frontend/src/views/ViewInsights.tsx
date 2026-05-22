import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { SectionTitle, Card, Pill } from '../components'

export function ViewInsights() {
  const [period, setPeriod] = useState('recent')

  const { data, isLoading, error } = useQuery({
    queryKey: ['insights', period],
    queryFn: () => api.insights(period),
  })

  return (
    <div>
      <SectionTitle no="01" sub="AI-powered analysis of your reading patterns">
        Insights
      </SectionTitle>

      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {[
          { id: 'recent', label: 'Recent' },
          { id: 'all', label: 'All time' },
        ].map(o => (
          <Pill key={o.id} active={period === o.id} onClick={() => setPeriod(o.id)}>
            {o.label}
          </Pill>
        ))}
      </div>

      <Card>
        {isLoading && (
          <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', padding: 32, textAlign: 'center' }}>
            Analyzing your reading history…
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--m2)', fontSize: 13 }}>
            Failed to load insights. Is the ANTHROPIC_API_KEY set?
          </div>
        )}
        {data && (data.summary?.startsWith('Error') ? (
          <div style={{ color: 'var(--m2)', fontSize: 13 }}>
            {(() => {
              const extracted = data.summary.match(/'message':\s*'([^']+)'/)?.[1]
              return extracted
                ? `Failed to generate insights: ${extracted}`
                : 'Failed to generate insights. Check the ANTHROPIC_API_KEY and your account credits.'
            })()}
          </div>
        ) : (
          <div className="serif" style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
            {data.summary}
          </div>
        ))}
      </Card>
    </div>
  )
}
