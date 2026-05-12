interface Props {
  src: string | null | undefined
  title: string
  width?: number
  height?: number
}

export function BookCover({ src, title, width = 40, height = 60 }: Props) {
  if (!src) {
    return (
      <div
        title={title}
        style={{
          width, height,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 2,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: Math.min(width, height) * 0.35,
          color: 'var(--muted-2)',
          flexShrink: 0,
        }}
      >
        ?
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={title}
      title={title}
      loading="lazy"
      width={width}
      height={height}
      style={{
        width, height,
        objectFit: 'cover',
        borderRadius: 2,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        flexShrink: 0,
      }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}
    />
  )
}
