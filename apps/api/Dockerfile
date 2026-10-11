# Build stage: install workspace deps and compile/produce the API bundle.
FROM oven/bun:1 AS build

WORKDIR /repo

# Install the whole workspace so workspace:* links resolve.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN bun install --frozen-lockfile

# Copy sources needed to typecheck/build.
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared

# Produce a standalone binary for the API.
WORKDIR /repo/apps/api
RUN bun build ./src/index.ts --target bun --outfile ./dist/server.js

# Runtime stage: lean image, no lockfile/sources needed.
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=build /repo/apps/api/dist/server.js ./server.js

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "run", "./server.js"]