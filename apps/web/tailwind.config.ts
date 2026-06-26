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
          soft: '#F4EFFC',
          violet: '#8B5CF6',
          glow: '#C084FC',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
      },
      boxShadow: {
        card: '0 12px 32px -12px rgba(15,23,42,0.16)',
        'card-hover': '0 28px 56px -18px rgba(107,63,160,0.34)',
        glow: '0 24px 70px -18px rgba(107,63,160,0.5)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg,#55307F 0%,#6B3FA0 42%,#8B5CF6 76%,#C084FC 100%)',
        'brand-sheen': 'linear-gradient(120deg,#6B3FA0 0%,#8B5CF6 50%,#C084FC 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
        blob: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(24px,-30px) scale(1.08)' },
          '66%': { transform: 'translate(-20px,20px) scale(0.95)' },
        },
        sheen: {
          '0%,100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.7s cubic-bezier(0.2,0.7,0.2,1) both',
        float: 'float 7s ease-in-out infinite',
        blob: 'blob 16s ease-in-out infinite',
        sheen: 'sheen 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
