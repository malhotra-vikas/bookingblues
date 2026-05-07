import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        paper: '#ffffff',
        muted: '#64748b',
        accent: '#0b5cd6',
      },
    },
  },
  plugins: [],
};

export default config;
