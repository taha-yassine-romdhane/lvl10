# ---------- build stage ----------
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runtime stage ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Production dependencies only (tsx is a runtime dependency for server.ts)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code and the prebuilt Next.js output
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY server.ts next.config.ts tsconfig.json ./
COPY src ./src

# Run as the unprivileged "node" user
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["npx", "tsx", "server.ts", "--prod"]
