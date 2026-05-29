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
        // KeeprSteady brand purple. DEFAULT drives bg-accent / text-accent /
        // border-accent / bg-accent/N tints. `dark` is the button hover
        // (darker purple); `light` is the dark-mode text shade (readable on
        // slate-950, replaces the old blue-400 pairing).
        accent: {
          DEFAULT: '#6B3FA0',
          dark: '#55307F',
          light: '#B79CE6',
        },
      },
    },
  },
  plugins: [],
};

export default config;
