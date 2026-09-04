import { HTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean
  glass?: boolean
  variant?: 'default' | 'bordered' | 'elevated'
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable = false, glass = false, variant = 'default', children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx(
          'rounded-2xl p-6',
          glass ? 'glass-card' : variant === 'bordered' ? 'bg-white border border-gray-100 shadow-sm' : variant === 'elevated' ? 'bg-white shadow-lg shadow-gray-200/60' : 'bg-white shadow-md shadow-gray-200/50',
          hoverable && 'hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 cursor-pointer',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  },
)

Card.displayName = 'Card'
