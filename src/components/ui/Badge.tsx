import { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  color?: 'blue' | 'green' | 'red' | 'purple' | 'yellow' | 'gray' | 'navy'
  size?: 'sm' | 'md'
}

export function Badge({ className, color = 'blue', size = 'sm', children, ...props }: BadgeProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-700 ring-blue-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-red-50 text-red-700 ring-red-200',
    purple: 'bg-purple-50 text-purple-700 ring-purple-200',
    yellow: 'bg-amber-50 text-amber-700 ring-amber-200',
    gray: 'bg-gray-50 text-gray-600 ring-gray-200',
    navy: 'bg-navy-50 text-navy ring-navy-100',
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center font-semibold rounded-full ring-1 ring-inset',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        colorClasses[color],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
