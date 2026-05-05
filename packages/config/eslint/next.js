import base from './base.js';

/**
 * Next.js apps may export default React components and Next.js page/layout files.
 * The Next plugin contributes additional rules; we relax `import/no-default-export`
 * for the App Router files that require it.
 */
export default [
  ...base,
  {
    files: ['app/**/*.{ts,tsx}', 'pages/**/*.{ts,tsx}', 'next.config.{js,mjs,ts}'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
];
