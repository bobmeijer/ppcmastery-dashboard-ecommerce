/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-alt': 'var(--paper-alt)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        muted: 'var(--gray-500)',
        subtle: 'var(--gray-400)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        DEFAULT: '10px',
        lg: '18px',
      },
    },
  },
  plugins: [],
};
