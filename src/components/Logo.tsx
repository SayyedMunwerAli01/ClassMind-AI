import { LOGO_URL } from '@/lib/constants'
import { clsx } from 'clsx'

interface LogoProps {
  /** Rendered square size in px. */
  size?: number
  className?: string
  /** Ring/glow treatment for dark backgrounds. */
  glow?: boolean
}

/**
 * The official ClassMind AI logo — one source of truth (LOGO_URL) shared by
 * every screen, header, auth page and the browser favicon.
 */
export function Logo({ size = 40, className, glow = false }: LogoProps) {
  return (
    <span
      className={clsx(
        'relative inline-flex items-center justify-center rounded-xl overflow-hidden shrink-0',
        glow && 'ring-1 ring-white/10 shadow-lg shadow-black/20',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={LOGO_URL(size * 2)}
        alt="ClassMind AI"
        width={size}
        height={size}
        className="w-full h-full object-contain"
        loading="eager"
        decoding="async"
      />
    </span>
  )
}

export default Logo
