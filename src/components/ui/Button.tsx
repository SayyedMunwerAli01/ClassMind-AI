import { ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gradient' | 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading = false, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all duration-200 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
          variant === 'primary' && 'bg-navy text-white hover:bg-navy-light shadow-md hover:shadow-lg hover:shadow-navy/20',
          variant === 'secondary' && 'bg-white text-navy border-2 border-navy/10 hover:border-navy/30 hover:shadow-md',
          variant === 'ghost' && 'bg-transparent text-navy hover:bg-navy/5',
          variant === 'dark' && 'bg-white/10 text-white border border-white/20 hover:bg-white/20 backdrop-blur-sm',
          variant === 'light' && 'bg-white text-navy hover:bg-gray-50 shadow-lg',
          variant === 'danger' && 'bg-red-500 text-white hover:bg-red-600 shadow-md hover:shadow-lg hover:shadow-red-500/20',
          variant === 'gradient' && 'bg-gradient-to-r from-accent-blue to-accent-purple text-white shadow-lg hover:shadow-xl hover:shadow-accent-blue/25',
          size === 'sm' && 'px-3.5 py-2 text-sm',
          size === 'md' && 'px-5 py-2.5 text-base',
          size === 'lg' && 'px-8 py-3.5 text-lg',
          className,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        )}
        {children}
      </button>
    )
  },
)

Button.displayName = 'Button'
