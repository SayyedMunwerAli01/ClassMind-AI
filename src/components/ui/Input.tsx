import { InputHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  icon?: React.ReactNode
  dark?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, dark = false, ...props }, ref) => {
    return (
      <div className="w-full">
        {label && (
          <label className={clsx(
            'block text-sm font-semibold mb-1.5',
            dark ? 'text-white/80' : 'text-navy',
          )}>{label}</label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={clsx(
              'input-field',
              icon && 'pl-11',
              error && 'border-red-400 focus:border-red-500 focus:ring-red-500/10',
              className,
            )}
            {...props}
          />
        </div>
        {error && <p className="text-red-500 text-xs mt-1.5 flex items-center gap-1">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'
