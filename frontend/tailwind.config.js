/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#5645d4',
          pressed: '#4534b3',
          deep: '#3a2a99',
        },
        'brand-navy': {
          DEFAULT: '#0a1530',
          deep: '#070f24',
          mid: '#1a2a52',
        },
        'link-blue': {
          DEFAULT: '#0075de',
          pressed: '#005bab',
        },
        'brand-orange': {
          DEFAULT: '#dd5b00',
          deep: '#793400',
        },
        'brand-pink': {
          DEFAULT: '#ff64c8',
          deep: '#a02e6d',
        },
        'brand-purple': {
          DEFAULT: '#7b3ff2',
          300: '#d6b6f6',
          800: '#391c57',
        },
        'brand-teal': '#2a9d99',
        'brand-green': '#1aae39',
        'brand-yellow': '#f5d75e',
        'brand-brown': '#523410',
        'card-tint': {
          peach: '#ffe8d4',
          rose: '#fde0ec',
          mint: '#d9f3e1',
          lavender: '#e6e0f5',
          sky: '#dcecfa',
          yellow: '#fef7d6',
          'yellow-bold': '#f9e79f',
          cream: '#f8f5e8',
          gray: '#f0eeec',
        },
        canvas: '#ffffff',
        surface: {
          DEFAULT: '#f6f5f4',
          soft: '#fafaf9',
        },
        hairline: {
          DEFAULT: '#e5e3df',
          soft: '#ede9e4',
          strong: '#c8c4be',
        },
        ink: {
          deep: '#000000',
          DEFAULT: '#1a1a1a',
        },
        charcoal: '#37352f',
        slate: '#5d5b54',
        steel: '#787671',
        stone: '#a4a097',
        muted: '#bbb8b1',
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Geist Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"Geist Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        xxl: '20px',
        xxxl: '24px',
        full: '9999px',
      },
      boxShadow: {
        'notion-card': '0px 1px 2px 0px rgba(15, 15, 15, 0.04)',
        'notion-feature': '0px 4px 12px 0px rgba(15, 15, 15, 0.08)',
        'notion-mockup': '0px 24px 48px -8px rgba(15, 15, 15, 0.20)',
        'notion-modal': '0px 16px 48px -8px rgba(15, 15, 15, 0.16)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
