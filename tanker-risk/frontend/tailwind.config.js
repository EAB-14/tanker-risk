/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
        display: ['"IBM Plex Serif"', 'Georgia', 'serif'],
      },
      colors: {
        // Neutral greys (unchanged — used for text, borders, backgrounds)
        ink: {
          50: '#f4f8fd',
          100: '#e8eef7',
          200: '#ccd8e8',
          300: '#a0b4cc',
          400: '#7090aa',
          500: '#4e6e8a',
          600: '#385470',
          700: '#263d56',
          800: '#192c40',
          900: '#0f1e2e',
          950: '#080e18',
        },
        // Onassis institutional blue — replaces gold accent throughout
        accent: {
          DEFAULT: '#1a5cbf',
          50:  '#e8f2fb',
          100: '#c5d8f4',
          200: '#9abfea',
          300: '#6ba3df',
          400: '#4189d4',
          500: '#1a5cbf',
          600: '#154fa8',
          700: '#103d88',
          800: '#0c2d6c',
          900: '#081d4a',
        },
        // Onassis header/strip gradient stops
        ons: {
          950: '#070f28',
          900: '#0c1e40',
          800: '#132d5e',
          700: '#1a3d7a',
          600: '#1f4d9a',
          500: '#2860b5',
          400: '#4a83cc',
          300: '#70a5df',
          200: '#9ec6ee',
          100: '#c8e0f8',
          50:  '#f5f9ff',
        },
        danger: '#a3321f',
        positive: '#2d6b3e',
        chart: {
          vlcc:    '#1a5cbf',
          suezmax: '#c0622a',
          aframax: '#3a7a5e',
          lr2:     '#7a4a9e',
          mr:      '#8a8020',
          handy:   '#5a7a90',
        },
      },
      borderRadius: {
        card: '6px',
        btn:  '6px',
      },
      boxShadow: {
        panel:        '0 1px 0 rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
        'panel-hover':'0 1px 0 rgba(0,0,0,0.04), 0 6px 16px rgba(12,30,64,0.12)',
        focus:        '0 0 0 3px rgba(26,92,191,0.28)',
        'focus-danger':'0 0 0 3px rgba(163,50,31,0.22)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        shimmer: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(2px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
        fadeIn:  'fadeIn 220ms cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
