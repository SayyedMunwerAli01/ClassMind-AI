/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#1E2761',
          light: '#2A3578',
          dark: '#151B45',
          50: '#EEF0F8',
          100: '#D4D8ED',
        },
        accent: {
          blue: '#4A90D9',
          purple: '#7B5EA7',
          light: '#F4F6FC',
          gold: '#F5A623',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          muted: '#F8F9FC',
          border: '#E8ECF4',
        },
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 16px 0 rgba(30, 39, 97, 0.06)',
        'medium': '0 4px 24px 0 rgba(30, 39, 97, 0.08)',
        'strong': '0 8px 40px 0 rgba(30, 39, 97, 0.12)',
        'glow-blue': '0 0 20px rgba(74, 144, 217, 0.3)',
        'glow-purple': '0 0 20px rgba(123, 94, 167, 0.3)',
        'inner-light': 'inset 0 1px 0 0 rgba(255,255,255,0.1)',
      },
      animation: {
        'fade-up': 'fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'shimmer': 'shimmer 2s infinite linear',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-gentle': 'bounceGentle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.25rem',
        '4xl': '1.5rem',
      },
    },
  },
  plugins: [],
}
