FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db-types/package.json packages/db-types/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* envs are baked at build time. Railway provides them via
# `--build-arg` (configured per service in railway.json).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm --filter @bookingblues/web... build

FROM node:22-alpine

RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo

RUN pnpm --filter @bookingblues/web... prune --prod

WORKDIR /repo/apps/web
ENV NODE_ENV=production
EXPOSE 3000
# `next start` reads PORT env (Railway-provided); falls back to 3000 locally.
CMD ["pnpm", "start"]
