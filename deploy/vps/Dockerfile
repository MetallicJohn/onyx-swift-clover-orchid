# Gridline VPS image. Build from the repository root:
#   docker build -f deploy/vps/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NITRO_PRESET=node-server
ENV VITE_AUTH_ENABLED=true
ENV NODE_ENV=production
RUN node scripts/with-app-env.mjs vite build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/.output /app/.output
COPY --from=build /app/migrations /app/migrations
COPY --from=build /app/scripts/migrate.mjs /app/scripts/migrate.mjs
COPY --from=build /app/scripts/migration-plan.mjs /app/scripts/migration-plan.mjs
COPY --from=build /app/package.json /app/package-lock.json /app/
RUN npm ci --omit=dev
COPY deploy/vps/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/entrypoint.sh"]
