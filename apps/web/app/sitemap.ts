import type { MetadataRoute } from 'next';

import { BRAND } from '../lib/brand';

/**
 * XML sitemap for search engines. Lists only public, indexable marketing pages
 * (not dashboard/auth/booking-result routes). Served at /sitemap.xml.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${BRAND.domain}`;
  const now = new Date();

  const routes: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/faq', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/contact', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/careers', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/messaging', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' },
  ];

  return routes.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
