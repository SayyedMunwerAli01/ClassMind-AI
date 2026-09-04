import { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'card' | 'circle' | 'rect'
}

export function Skeleton({ className, variant = 'text', ...props }: SkeletonProps) {
  return (
    <div
      className={clsx(
        'skeleton',
        variant === 'text' && 'h-4 rounded',
        variant === 'card' && 'h-40 rounded-2xl',
        variant === 'circle' && 'h-12 w-12 rounded-full',
        variant === 'rect' && 'h-24 rounded-xl',
        className,
      )}
      {...props}
    />
  )
}