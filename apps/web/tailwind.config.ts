import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  // Class-based dark mode toggled via the `ThemeToggle` button; the root
  // class is set in `RootLayout`'s no-flash inline script.
  darkMode: 'class',
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
