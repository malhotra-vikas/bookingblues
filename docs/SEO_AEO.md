# SEO & AEO — living tracker

Two separate disciplines, tracked separately:
- **SEO** = rank in search engines (blue links). Google/Bing.
- **AEO** = get cited/recommended *inside* AI answers (ChatGPT, Claude, Gemini, Perplexity, Google AI Overviews).

Status legend: ✅ done · 🚧 in progress · ⬜ not started · 👤 = off-platform, only the founder can do it.

Deployed to prod: **2026-07-15** (verified live: sitemap.xml, robots.txt with AI-bot rules, /llms.txt, /answering-service-for-contractors, /for/{trade} ×5).

---

## SEO

### ✅ Shipped (in code, deployed)
- **Tier 1 — technical foundation**
  - `app/sitemap.ts` → `/sitemap.xml` (all public marketing pages + trade pages).
  - `app/robots.ts` → `/robots.txt` (allow public, block app/auth, sitemap link).
  - JSON-LD: **Organization** (root layout), **SoftwareApplication + Offers** (home), **FAQPage** (/faq).
  - Per-page metadata/canonicals verified; OG/Twitter + icons already present.
  - Re-verified Googlebot is not Cloudflare-challenged (200, no `cf-mitigated`).
- **Tier 2 — per-trade landing pages** (`lib/trades.ts` + `/for/[trade]`)
  - 5 keyword-targeted pages: plumbers, hvac, electricians, roofers, garage-door.
  - Differentiated copy (jobs, emergencies, benefits, FAQ) per trade — not thin/duplicate.
  - FAQ JSON-LD per page; internal links from footer ("For your trade") + between pages.

### ⬜ Pending — post-deploy actions (👤 founder)
- [ ] 👤 **Google Search Console**: add property → submit `sitemap.xml` → Request indexing on home, /pricing, /answering-service-for-contractors, each /for/{trade}.
- [ ] 👤 **Bing Webmaster Tools**: add property + submit sitemap (also enables IndexNow).
- [ ] 👤 Validate structured data in Google **Rich Results Test** (FAQ/Org/Software should pass).

### ⬜ Backlog — SEO Tier 3 + polish (code, not yet built)
- [ ] Blog/resources section (`/blog`) for long-tail + comparison content (ongoing engine).
- [ ] Trade links in the **top nav** (currently footer only).
- [ ] Per-page **OG images** (currently one shared og-image.png).
- [ ] Make trade/marketing pages **static** again (currently dynamic due to promo `no-store`) if page-speed matters — or move the promo banner to a client component.
- [ ] Page-speed / Core Web Vitals pass; image alt-text audit.
- [ ] More trade/city intent pages as the funnel proves out.

---

## AEO (Answer Engine Optimization)

### ✅ Shipped (in code, deployed)
- **Explicit AI-crawler welcome** in `robots.txt`: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, anthropic-ai, Claude-Web, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, cohere-ai (public pages only).
- **`/llms.txt`** (route handler) — curated, in-sync markdown summary + quotable one-line definition + per-trade links.
- **HowTo schema** (home, 4-step booking flow) + **Service schema** (each /for/{trade}).
- **Answer/comparison page** `/answering-service-for-contractors` — direct-answer opening paragraph, voicemail-vs-human-vs-AI table, FAQ schema. Targets "best answering service for contractors."
- Quotable definitions reinforced across meta description, SoftwareApplication schema, and llms.txt.

### ⬜ Pending — off-site authority (👤 founder — THIS is where AEO is won)
AI recommends what's corroborated across many independent sources. Priority order:
- [ ] 👤 **Google Business Profile** — claim/create. High trust + "near me".
- [ ] 👤 **G2** listing (highest-ROI — LLMs cite G2 for "best X software").
- [ ] 👤 **Capterra** listing (+ shares network with Software Advice / GetApp).
- [ ] 👤 **Trustpilot** listing.
- [ ] 👤 **Collect 5–10 real reviews** on G2/Capterra/Google from happy operators → unlocks `AggregateRating` schema later.
- [ ] 👤 **Product Hunt** launch; **AlternativeTo** (list as an alternative to answering services/competitors); SaaS directories.
- [ ] 👤 Get into **"best missed-call text-back / answering service for contractors" listicles** (pitch writers).
- [ ] 👤 Genuine participation in **r/plumbing, r/HVAC, r/electricians, r/Contractor** + trade forums (helpful, not spammy).

### ⬜ Pending — verification + code follow-ups
- [x] 👤 **Cloudflare AI bot access** (verified 2026-07-15): "Block AI training bots" = **Do not block (allow crawlers)**; "Manage robots.txt" = **Disable** (so our app robots.txt is served — confirmed live). Keep both as-is. TODO: glance at sidebar **AI Crawl Control** for per-bot overrides, and **Security → Bots** (Bot Fight Mode off).
- [ ] Add **AggregateRating / Review JSON-LD** hook (build once real reviews exist).
- [ ] After ~1–2 weeks: **test** on ChatGPT (search), Perplexity, Claude, Gemini — "good AI answering service for plumbers?" — and iterate on gaps.

---

## Honest expectations
- The **code** (both SEO Tier 1/2 and AEO technicals) makes us crawlable, structured, and quotable — ahead of most competitors.
- **Ranking** (SEO) and **being recommended** (AEO) depend heavily on the 👤 off-site items (indexing, reviews, directories, mentions), which take weeks and can't be coded. Highest single lever: **G2 + Capterra + a handful of real reviews.**
