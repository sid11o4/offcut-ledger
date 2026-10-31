/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Achromatic ledger (dealt by design-taste-frontend, kind=finance, Oct 2026): no brand
        // colour in the chrome at all. `ink` is the neutral scale (near-black text down to the
        // page ground); `brand` is repurposed as the one chart/accent hue, used only on the
        // screen's main data element or the rare primary control that needs to stand out from
        // the near-black default -- never as chrome decoration.
        ink: {
          950: '#0a0a0a',
          900: '#141414',
          800: '#242424',
          700: '#3d3d3d',
          600: '#525252',
          500: '#6b6b6b',
          400: '#8a8a8a',
          300: '#d4d4d4',
          200: '#e6e6e6',
          100: '#eeeeee',
          50: '#f8f8f8',
        },
        brand: {
          700: '#15468f',
          600: '#1d5fbf',
          500: '#3a74c9',
          100: '#e4ecf9',
        },
        ok: '#2e7d32',
        warn: '#92400e',
        bad: '#c4242a',
        pill: {
          'ok-bg': '#dcfae5', 'ok-ink': '#04250e',
          'bad-bg': '#ffedea', 'bad-ink': '#831c1e',
          'warn-bg': '#fffbeb', 'warn-ink': '#92400e',
          'neutral-bg': '#eeeeee', 'neutral-ink': '#3d3d3d',
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'ui-sans-serif', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
