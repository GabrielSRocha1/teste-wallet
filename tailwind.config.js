/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          DEFAULT: '#D4AF37',
          light: '#F0D060',
          dark: '#B8960C',
        },
        neon: {
          green: '#00FF9C',
          blue: '#00D4FF',
          purple: '#9B59FF',
        },
        dark: {
          950: '#02040A',
          900: '#060912',
          800: '#0A0F1E',
          700: '#0F1629',
          600: '#141C34',
          500: '#1A2440',
          400: '#1E2A4A',
          300: '#243054',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #D4AF37 0%, #F0D060 50%, #B8960C 100%)',
        'dark-gradient': 'linear-gradient(180deg, #02040A 0%, #060912 100%)',
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        'glow-gold': 'radial-gradient(ellipse at center, rgba(212,175,55,0.15) 0%, transparent 70%)',
        'glow-green': 'radial-gradient(ellipse at center, rgba(0,255,156,0.1) 0%, transparent 70%)',
      },
      boxShadow: {
        'gold': '0 0 30px rgba(212,175,55,0.3), 0 0 60px rgba(212,175,55,0.1)',
        'gold-sm': '0 0 15px rgba(212,175,55,0.25)',
        'neon-green': '0 0 20px rgba(0,255,156,0.4)',
        'glass': '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
        'card': '0 4px 24px rgba(0,0,0,0.6), 0 1px 0 rgba(212,175,55,0.1)',
      },
      animation: {
        'count-up': 'countUp 1s ease-out forwards',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
        'glow': 'glow 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        countUp: {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(212,175,55,0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(212,175,55,0.6)' },
        },
        glow: {
          '0%, 100%': { opacity: 0.6 },
          '50%': { opacity: 1 },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
