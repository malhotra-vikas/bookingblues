# @bookingblues/web

Next.js 15 (App Router). Operator dashboard, signup, settings, marketing pages.
Talks to the API and Supabase Auth — never directly to Twilio, Stripe, OpenAI, or Google.

## Run locally

```bash
pnpm dev --filter @bookingblues/web
# or, from this directory:
pnpm dev
```

Open http://localhost:3000

## Layout (per CLAUDE.md §5)

```
app/
  (marketing)/    # /, /pricing, /faq
  (auth)/         # /login, /signup
  (dashboard)/    # /dashboard, /settings, /appointments
  api/            # only thin proxies if absolutely needed
components/
lib/
```

Skeleton currently has only the placeholder landing page at `app/page.tsx`.
