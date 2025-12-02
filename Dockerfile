# -------------------------
# STAGE 1: Build TypeScript
# -------------------------
FROM node:18 AS builder
WORKDIR /app

# Copy package files separately for better caching
COPY package.json package-lock.json ./

# Install all dependencies (including dev deps)
RUN npm ci

# Copy all source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript -> dist
RUN npm run build


# -------------------------
# STAGE 2: Production image
# -------------------------
FROM node:18-alpine AS runner
WORKDIR /app

# Copy package files for production install
COPY package.json package-lock.json ./

# 🔥 Prevent Husky from running in production build
ENV HUSKY=0

# Install production-only dependencies
RUN npm ci --production

# Copy compiled JS files from builder stage
COPY --from=builder /app/dist ./dist

# Environment variables (optional defaults)
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start the compiled app
CMD ["node", "dist/server.js"]
