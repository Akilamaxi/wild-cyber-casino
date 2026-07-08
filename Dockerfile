# ==========================================
# STAGE 1: Build Frontend SPA assets
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy root workspace configurations
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY packages/shared/package*.json ./packages/shared/
COPY apps/lottery-engine/package*.json ./apps/lottery-engine/
COPY apps/payout-worker/package*.json ./apps/payout-worker/
COPY apps/backoffice-api/package*.json ./apps/backoffice-api/

# Bootstrap all monorepo links and install modules
# Removing package-lock.json before install resolves the cross-platform Vite/Rollup native binary issue
RUN rm -f package-lock.json */package-lock.json */*/package-lock.json && npm install

# Copy source codes
COPY packages/ ./packages/
COPY frontend/ ./frontend/

# Compile frontend production bundle
RUN npm run build:frontend

# ==========================================
# STAGE 2: Build slim production runner
# ==========================================
FROM node:20-alpine
WORKDIR /app

# Copy root configurations and workspace lists
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/lottery-engine/package*.json ./apps/lottery-engine/
COPY apps/payout-worker/package*.json ./packages/payout-worker/

# Install only production dependencies
RUN npm install --omit=dev

# Copy server packages source codes
COPY packages/ ./packages/
COPY apps/ ./apps/

# Copy built frontend bundle from Stage 1 into main server static assets
COPY --from=frontend-builder /app/frontend/dist ./apps/lottery-engine/dist

# Expose port (Cloud Run sets PORT env, defaults to 8080)
EXPOSE 8080

# Configure production environment execution variables
WORKDIR /app/apps/lottery-engine
ENV PORT=8080
ENV NODE_ENV=production
ENV RUN_WORKER_CONCURRENTLY=true

# Start API server (which forks scheduling worker process on boot)
CMD ["node", "server.js"]
