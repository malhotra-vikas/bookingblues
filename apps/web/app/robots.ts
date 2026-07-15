import type { MetadataRoute } from 'next';

import { BRAND } from '../lib/brand';

/**
 * robots.txt — allow crawling of public marketing pages, block the app + auth
 * surfaces, and point crawlers at the sitemap. Served at /robots.txt.
 *
 * AEO: we explicitly WELCOME the AI answer-engine crawlers (ChatGPT, Claude,
 * Perplexity, Gemini/Google) so KeeprSteady can be cited and recommended inside
 * their answers. Each gets the same access as a normal crawler (public pages
 * only; app/auth routes stay private).
 */
const PRIVATE = ['/dashboard', '/admin', '/sales', '/onboarding', '/settings', '/auth', '/booking', '/api'];

// Answer-engine / AI crawlers we want reading the site.
const AI_AGENTS = [
  'GPTBot', // OpenAI (training + ChatGPT)
  'OAI-SearchBot', // OpenAI search/retrieval (citations in ChatGPT search)
  'ChatGPT-User', // ChatGPT browsing on a user's behalf
  'ClaudeBot', // Anthropic crawler
  'anthropic-ai', // Anthropic (legacy UA)
  'Claude-Web', // Claude browsing
  'PerplexityBot', // Perplexity
  'Perplexity-User', // Perplexity user-initiated fetch
  'Google-Extended', // Gemini / Google AI (Vertex/Bard) training signal
  'Applebot-Extended', // Apple Intelligence
  'cohere-ai',
  'Bytespider', // (TikTok) — allow discovery; remove if undesired
];

export default function robots(): MetadataRoute.Robots {
  const base = `https://${BRAND.domain}`;
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: PRIVATE },
      // Explicit welcome for AI answer engines (same access as any crawler).
      ...AI_AGENTS.map((ua) => ({ userAgent: ua, allow: '/', disallow: PRIVATE })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
