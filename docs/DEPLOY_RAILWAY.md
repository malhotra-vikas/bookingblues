# Deploy to Railway (staging)

End-to-end checklist to get a working Railway environment so we can run the E2E loop with real providers. **Do steps in order** — later steps reference URLs/keys produced earlier.

> **Production target is EC2** (Slice 14). Railway is staging. Slice 13 cleans this up.

---

## Prereqs (one-time)

- GitHub repo: https://github.com/malhotra-vikas/bookingblues (already pushed)
- Railway account + a fresh project: https://railway.com → New Project → "Deploy from GitHub repo" → pick `malhotra-vikas/bookingblues`. Don't click any auto-deploy yet — we configure first.
- Hosted Supabase project (separate from local): https://supabase.com/dashboard → New project (US-East 2 is fine). Wait ~2 min for provisioning.
- Run our migrations against the hosted DB (one-time, from your local terminal):
  ```bash
  supabase link --project-ref <your-project-ref>
  supabase db push   # applies migrations 0001/0002/0003 + slot dedup
  ```
  Verify in Supabase Studio → Table editor that `operators`, `appointments`, `categories`, etc. exist.

---

## Service 1 — `api`

**In the Railway dashboard, in your project:**

1. **Add Service → GitHub Repo** → pick `bookingblues`. Railway will auto-detect.
2. Service Settings → **Source**:
   - Branch: `main`
   - **Root Directory: leave at `/`** (we need the workspace install)
3. Service Settings → **Build**:
   - Builder: **Dockerfile**
   - Dockerfile Path: `apps/api/Dockerfile`
4. Service Settings → **Deploy**:
   - Healthcheck Path: `/v1/health`
   - Restart Policy: On failure, max 3
5. Service Settings → **Networking** → Generate Public Domain. Note the URL → this is your `API_URL`. (e.g. `bookingblues-api.up.railway.app`)
6. Service Settings → **Variables** — paste each (we'll fill provider creds later):
   ```
   NODE_ENV=production
   LOG_LEVEL=info
   APP_URL=<filled after Service 2 has its public domain>
   API_URL=https://<this service's public domain>
   PORT=$PORT
   SUPABASE_URL=https://<your-project-ref>.supabase.co
   SUPABASE_ANON_KEY=<from Supabase dashboard → Settings → API>
   SUPABASE_SERVICE_ROLE_KEY=<same place — server-only, never copy to web>
   SUPABASE_JWT_SECRET=<Supabase dashboard → Settings → API → JWT Settings>
   ENCRYPTION_KEY=<see "Encryption key" below>
   PLATFORM_TAKE_RATE_BPS=1000
   MIN_PLATFORM_FEE_CENTS=100
   TRIAL_DAYS=7
   GOOGLE_OAUTH_REDIRECT_URI=https://<api domain>/webhooks/google/oauth/callback
   ```
   Provider creds added in their dedicated steps below.

   **Encryption key (generate one):**
   ```bash
   node -e "console.log('1:'+require('crypto').randomBytes(32).toString('hex'))"
   ```
   This is the value for `ENCRYPTION_KEY`. **Save a copy in 1Password / your vault** — losing it means encrypted refresh tokens can't be decrypted.

7. **Don't deploy yet** — finish Service 2 first so we can fill `APP_URL` cleanly.

---

## Service 2 — `web`

1. Same project → **Add Service → GitHub Repo** → same repo. Railway will create a 2nd service alongside `api`.
2. Service Settings → **Source**:
   - Branch: `main`
   - **Root Directory: `/`**
3. Service Settings → **Build**:
   - Builder: **Dockerfile**
   - Dockerfile Path: `apps/web/Dockerfile`
4. Service Settings → **Networking** → Generate Public Domain. Note → this is `APP_URL`.
5. Service Settings → **Variables**:
   ```
   NODE_ENV=production
   PORT=$PORT
   NEXT_PUBLIC_APP_URL=https://<this service's public domain>
   NEXT_PUBLIC_API_URL=https://<api service's public domain>
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<same anon key>
   ```

   **Important:** `NEXT_PUBLIC_*` are baked at build time. Service Settings → **Build** → check "Build Args" if Railway exposes them, otherwise the variables must be set BEFORE the first deploy. Re-deploy whenever any `NEXT_PUBLIC_*` changes.

6. Now **go back to Service 1 (`api`)** and fill `APP_URL` with the web domain you just generated.

---

## Provider creds (in order — each step produces values that go into the api / web service variables in Railway)

### Sentry
1. https://sentry.io → Projects → Create Project → choose **Node.js** for `bookingblues-api` and **Next.js** for `bookingblues-web`.
2. Each project gives you a DSN → paste into:
   - api service: `SENTRY_DSN_API=<the api project's DSN>`
   - web service: `SENTRY_DSN_WEB=<the web project's DSN>` *(also needs to be NEXT_PUBLIC if surfaced to the browser bundle — Phase 3 wires the actual init)*

### Resend
1. https://resend.com → API Keys → create key.
2. Verify a sending domain (or use their `onboarding@resend.dev` test sender for now).
3. api service: `RESEND_API_KEY=re_...`

### Stripe (test mode)
1. https://dashboard.stripe.com → ensure **View test data** toggle is on (top-right).
2. **Products → Add product** → "BookingBlues Starter" → recurring monthly $49 USD → save → copy the **price ID** (starts `price_…`).
3. Repeat for Pro ($149).
4. **Settings → Connect → Get started** → enable Connect platform → Express accounts.
5. Developers → API keys → copy:
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_PUBLISHABLE_KEY=pk_test_...` *(web service)*
6. Developers → Webhooks → **Add endpoint**:
   - Endpoint URL: `https://<api domain>/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.trial_will_end`, `invoice.payment_succeeded`, `invoice.payment_failed`
   - Copy signing secret → `STRIPE_WEBHOOK_SECRET=whsec_...`
7. Developers → Webhooks → **Add endpoint** *(separate one for Connect)*:
   - Endpoint URL: `https://<api domain>/webhooks/stripe/connect`
   - Toggle "Listen to events on Connected accounts"
   - Events: `account.updated`, `payment_intent.succeeded`, `charge.refunded`
   - Copy signing secret → `STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...`
8. Variables to set on api service:
   ```
   STRIPE_SECRET_KEY
   STRIPE_WEBHOOK_SECRET
   STRIPE_CONNECT_WEBHOOK_SECRET
   STRIPE_PRICE_STARTER
   STRIPE_PRICE_PRO
   ```
9. Variables on web service: `STRIPE_PUBLISHABLE_KEY` (publishable key only; never expose secret to the browser).

### OpenAI
1. https://platform.openai.com/api-keys → create a **Project** key (not the personal default — easier to revoke).
2. api service: `OPENAI_API_KEY=sk-proj-...`

### Google Cloud (Calendar OAuth)
1. https://console.cloud.google.com → New Project "BookingBlues Staging".
2. APIs & Services → **Library** → enable "Google Calendar API".
3. APIs & Services → **OAuth consent screen** → External, Testing. Add yourself as a test user.
4. APIs & Services → **Credentials** → Create OAuth Client ID → Web application.
   - Authorized redirect URIs: `https://<api domain>/webhooks/google/oauth/callback`
5. api service:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=https://<api domain>/webhooks/google/oauth/callback
   ```

### Twilio
1. https://console.twilio.com → free trial gives ~$15 credit.
2. Account dashboard → copy:
   - `TWILIO_ACCOUNT_SID=AC...`
   - `TWILIO_AUTH_TOKEN=...`
3. **Don't buy a number yet** — the onboarding wizard provisions one for the test operator. The wizard configures voice + SMS webhooks against the API URL automatically using `API_URL` from env.
4. **Verified Caller IDs** — verify the phone numbers you'll test from / to (Trial accounts can only message verified numbers).
5. api service:
   ```
   TWILIO_ACCOUNT_SID
   TWILIO_AUTH_TOKEN
   OUTBOUND_SMS_ALLOWLIST=+1<your real mobile in E.164>
   ```
   (allowlist only matters in non-prod per §11.12, but `NODE_ENV=production` on Railway means the allowlist is BYPASSED. For staging safety, consider running NODE_ENV=staging or temporarily setting it to `development` until you trust it.)

---

## Deploy + verify

1. In Railway, click **Deploy** on each service. Watch the build logs.
2. After both services are green:
   - `curl https://<api domain>/v1/health` → `{"status":"ok"...}`
   - Hit `https://<web domain>` in a browser → marketing landing page renders
   - `curl -sI https://<api domain>/v1/health` → confirm `Strict-Transport-Security: ... preload` and no `X-Powered-By`
3. **Run the E2E loop** — see `docs/project_resume_after_restart.md` Step 5 walkthrough.

---

## Common pitfalls

- **Build fails with workspace-package not-found** — double-check the Dockerfile copies all `packages/*/package.json` into the workspace before `pnpm install`. Already handled in the Dockerfiles.
- **`NEXT_PUBLIC_*` empty in the browser** — they were missing at build time. Set them in Railway BEFORE the first deploy and re-deploy.
- **Twilio webhook signature failures** — `validateSignature` reconstructs the URL as `${API_URL}${req.originalUrl}`. `API_URL` env var on the api service must EXACTLY match Railway's public domain (https://, no trailing slash).
- **Stripe webhook signature failures in dev still using ngrok-style URLs** — make sure the new Railway URL is what's configured in Stripe; remove any ngrok endpoints.
- **Supabase `auth.getUser` 5–50ms** — every authenticated request makes one extra HTTP hop. Acceptable for staging; track for Slice 11 observability.
- **Cold starts after low traffic** — Railway sleeps inactive services on the free tier. First request after sleep can take 5–10s; Twilio's 15s webhook timeout is fine but the user-facing UX feels slow. Production target is EC2 (Slice 14).
