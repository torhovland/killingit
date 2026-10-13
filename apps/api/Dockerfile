# Build stage: install workspace deps and compile/produce the API bundle.
FROM oven/bun:1 AS build

WORKDIR /repo

# Sentry source-map upload config (build args). The auth token is passed as a
# BuildKit *secret* (see deploy.yml) so it never lands in an image layer.
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE

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

# Produce a standalone bundle with an external source map so Sentry can
# un-minify production stack traces.
WORKDIR /repo/apps/api
RUN bun build ./src/index.ts --target bun --sourcemap=external --outdir ./dist

# Install Sentry CLI for source-map debug-ID injection + upload.
RUN bun add -g @sentry/cli

# Inject debug IDs and upload source maps so runtime stack frames resolve to
# source. Skipped when no auth token is supplied (local / non-CI builds).
RUN --mount=type=secret,id=SENTRY_AUTH_TOKEN \
    if [ -n "$SENTRY_ORG" ] && [ -n "$SENTRY_PROJECT" ]; then \
      export SENTRY_AUTH_TOKEN="$(cat /run/secrets/SENTRY_AUTH_TOKEN 2>/dev/null || true)"; \
      if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
        set -e; \
        sentry-cli sourcemaps inject --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" ./dist; \
        if [ -n "$SENTRY_RELEASE" ]; then \
          sentry-cli sourcemaps upload --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" --release "$SENTRY_RELEASE" ./dist; \
        else \
          sentry-cli sourcemaps upload --org "$SENTRY_ORG" --project "$SENTRY_PROJECT" ./dist; \
        fi; \
      fi; \
    fi

# Runtime stage: lean image, no lockfile/sources needed.
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=build /repo/apps/api/dist/index.js ./index.js

ENV NODE_ENV=production
ENV PORT=8080

# Sentry is enabled only when SENTRY_DSN is provided at runtime; leaving these
# unset in the image means the container starts with Sentry disabled until the
# deploy pipeline injects them.
ENV SENTRY_DSN=""
ENV SENTRY_RELEASE=""

EXPOSE 8080

CMD ["bun", "./index.js"]