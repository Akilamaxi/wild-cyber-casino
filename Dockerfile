# syntax=docker/dockerfile:1.7
# ==========================================
# STAGE 1: Build Frontend SPA assets
# ==========================================
FROM node:20.19-alpine AS frontend-builder
WORKDIR /app

# Copy root workspace configurations
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY admin-frontend/package*.json ./admin-frontend/
COPY packages/shared/package*.json ./packages/shared/
COPY apps/lottery-engine/package*.json ./apps/lottery-engine/
COPY apps/payout-worker/package*.json ./apps/payout-worker/
COPY apps/backoffice-api/package*.json ./apps/backoffice-api/
COPY apps/loyalty-engine/package*.json ./apps/loyalty-engine/

# Reproducible workspace install from the committed lockfile.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

# Copy source codes
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY frontend/ ./frontend/
COPY admin-frontend/ ./admin-frontend/

# Compile frontend production bundles and NestJS microservices
RUN npm run build --workspace=@cyber-casino/shared && \
    npm run build:frontend && npm run build:admin && \
    npx nest build lottery-engine --config apps/lottery-engine/nest-cli.json --path apps/lottery-engine/tsconfig.json && \
    npx nest build loyalty-engine --config apps/loyalty-engine/nest-cli.json --path apps/loyalty-engine/tsconfig.json && \
    npx nest build payout-worker --config apps/payout-worker/nest-cli.json --path apps/payout-worker/tsconfig.json && \
    npx nest build backoffice-api --config apps/backoffice-api/nest-cli.json --path apps/backoffice-api/tsconfig.json

# ==========================================
# STAGE 2: Build slim production runner
# ==========================================
FROM node:20.19-alpine
WORKDIR /app

# Copy root configurations and workspace lists
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY admin-frontend/package*.json ./admin-frontend/
COPY packages/shared/package*.json ./packages/shared/
COPY apps/lottery-engine/package*.json ./apps/lottery-engine/
COPY apps/payout-worker/package*.json ./apps/payout-worker/
COPY apps/backoffice-api/package*.json ./apps/backoffice-api/
COPY apps/loyalty-engine/package*.json ./apps/loyalty-engine/

# Install only production dependencies
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev && npm cache clean --force

# Copy server packages source codes and compiled NestJS outputs
COPY --chown=node:node packages/ ./packages/
COPY --from=frontend-builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node apps/lottery-engine/package*.json ./apps/lottery-engine/
COPY --chown=node:node apps/loyalty-engine/package*.json ./apps/loyalty-engine/
COPY --chown=node:node apps/payout-worker/package*.json ./apps/payout-worker/
COPY --chown=node:node apps/backoffice-api/package*.json ./apps/backoffice-api/
COPY --from=frontend-builder /app/apps/lottery-engine/dist ./apps/lottery-engine/dist
COPY --from=frontend-builder /app/apps/loyalty-engine/dist ./apps/loyalty-engine/dist
COPY --from=frontend-builder /app/apps/payout-worker/dist ./apps/payout-worker/dist
COPY --from=frontend-builder /app/apps/backoffice-api/dist ./apps/backoffice-api/dist

# Copy built frontend bundle from Stage 1 into main server static assets
COPY --from=frontend-builder /app/frontend/dist ./apps/lottery-engine/dist/public
COPY --from=frontend-builder /app/admin-frontend/dist ./apps/lottery-engine/dist/public/admin
COPY --chown=node:node scripts/cloud-run-supervisor.cjs ./scripts/cloud-run-supervisor.cjs

# Expose port (Cloud Run sets PORT env, defaults to 8080)
EXPOSE 8080

# Configure production environment execution variables
WORKDIR /app/apps/lottery-engine
ENV PORT=8080
ENV NODE_ENV=production
ENV RUN_WORKER_CONCURRENTLY=false

USER node

# Cloud Run/default image startup: supervise the public gateway and localhost-only services.
# Docker Compose overrides this command for each independently managed service.
CMD ["node", "/app/scripts/cloud-run-supervisor.cjs"]
