# Build stage — installs the entire workspace, then builds just @bookingblues/api.
# pnpm `--filter` keeps the build scoped, but the monorepo-wide install is needed
# so workspace `:*` packages (db-types, shared, config) resolve via the lockfile.
FROM node:22-alpine AS build

RUN corepack enable
WORKDIR /repo

# Layer 1: dependency manifests (cached unless any package.json changes)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/db-types/package.json packages/db-types/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile

# Layer 2: source
COPY . .

RUN pnpm --filter @bookingblues/api... build

# Run stage — production dependencies only.
FROM node:22-alpine

RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo

# Prune dev deps after the build to slim the runtime image.
RUN pnpm --filter @bookingblues/api... prune --prod

WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3001
# Railway passes PORT dynamically; env.ts coerces it. Default 3001 in dev.
CMD ["node", "dist/main.js"]
