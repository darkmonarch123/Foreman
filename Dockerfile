# syntax=docker/dockerfile:1
#
# Foreman container image, for local development and testing with Docker,
# Docker Compose and Kubernetes on Docker Desktop. Production runs on Render
# (render.yaml); this image is not used there.
#
# Supabase stays the managed backend: the container only runs the Next.js app.
#
# The NEXT_PUBLIC_* values are compiled into the browser bundle at build time,
# so they are build arguments. They are public by design (the anon key is
# protected by Row Level Security). Never pass the service-role key.
#
#   docker build -t foreman:local \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
#     --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3000 .

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- 1. all dependencies, for the build ------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. production dependencies only -----------------------------------------
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- 4. runtime -------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./

# The official image's unprivileged user.
USER node
EXPOSE 3000

# Same endpoint Render and Kubernetes use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
