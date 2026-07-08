# ==========================================
# STAGE 1: Build Frontend Assets
# ==========================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy dependencies manifest
COPY frontend/package*.json ./
RUN npm install

# Copy source and build static assets
COPY frontend/ ./
RUN npm run build

# ==========================================
# STAGE 2: Run Production backend
# ==========================================
FROM node:20-alpine

WORKDIR /app

# Copy backend dependencies manifest
COPY backend/package*.json ./backend/
RUN cd backend && npm install --only=production

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend assets into backend static folder
COPY --from=frontend-builder /app/frontend/dist ./backend/dist

# Expose server port (Cloud Run dynamically sets PORT env var)
EXPOSE 8080

# Run backend server
WORKDIR /app/backend
ENV PORT=8080
CMD ["node", "server.js"]
