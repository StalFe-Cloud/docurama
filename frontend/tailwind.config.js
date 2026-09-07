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
        canvas: '#0a0a0a',
        'canvas-soft': '#1a1c20',
        'canvas-card': '#191919',
        'canvas-mid': '#363a3f',
        hairline: '#212327',
        ink: '#ffffff',
        'ink-hover': '#fafaf7',
        body: '#dadbdf',
        'body-mid': '#7d8187',
        mute: '#7d8187',
        'accent-sunset': '#ff7a17',
        'accent-sunset-soft': '#ffc285',
        'accent-dusk': '#7c3aed',
        'accent-twilight': '#c4b5fd',
        'accent-breeze': '#a0c3ec',
        'accent-midnight': '#0d1726',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'sm': '8px',
        'pill': '9999px',
      },
      animation: {
        'pulse-subtle': 'pulseSubtle 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        pulseSubtle: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.8 },
        },
      },
    },
  },
  plugins: [],
}
