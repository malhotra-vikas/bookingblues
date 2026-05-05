# @bookingblues/api

NestJS API. Sole owner of all third-party integrations (Twilio, Stripe, OpenAI, Google).

## Run locally

```bash
pnpm dev --filter @bookingblues/api
# or, from this directory:
pnpm dev
```

Health check: `GET http://localhost:3001/v1/health`

## Layout (per CLAUDE.md §5)

```
src/
  modules/        # vertical slices: controller, service, repository, dto, types, tests
  common/         # guards, interceptors, filters, decorators
  config/         # env loading, validation
  jobs/           # pg-boss workers
  main.ts
```

Skeleton currently contains only `modules/health` and the bootstrap. Domain modules
(auth, billing, telephony, conversations, ai, calendar, appointments, payments,
operators, webhooks) get added incrementally.
