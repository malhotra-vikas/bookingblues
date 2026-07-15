import type { MetadataRoute } from 'next';

import { BRAND } from '../lib/brand';

/**
 * robots.txt — allow crawling of public marketing pages, block the app + auth
 * surfaces, and point crawlers at the sitemap. Served at /robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  const base = `https://${BRAND.domain}`;
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/admin', '/sales', '/onboarding', '/settings', '/auth', '/booking', '/api'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
