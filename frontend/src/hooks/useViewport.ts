import { useEffect, useState } from 'react'

// Breakpoints kept deliberately simple. Match Tailwind's md/lg roughly
// so the values feel familiar.
const MOBILE_BREAKPOINT = 768   // phones + small tablets in portrait
const TABLET_BREAKPOINT = 1024  // tablets in landscape, narrow laptops

export interface Viewport {
  width: number
  isMobile: boolean   // < 768
  isTablet: boolean   // 768 ≤ width < 1024
  isDesktop: boolean  // ≥ 1024
}

function read(): Viewport {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth
  return {
    width: w,
    isMobile:  w < MOBILE_BREAKPOINT,
    isTablet:  w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT,
    isDesktop: w >= TABLET_BREAKPOINT,
  }
}

/**
 * Reactive viewport state. Re-renders the consumer on window resize.
 *
 * Use for layout decisions that genuinely need JS (e.g. choosing how
 * many columns a grid should have, or whether to render a sidebar vs.
 * a hamburger drawer). For purely visual tweaks prefer CSS media
 * queries in index.css.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read)

  useEffect(() => {
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setVp(read()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return vp
}
