# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build arguments for environment variables
ARG PUBLIC_CONVEX_URL
ARG VITE_RECIPIENT_ADDRESS

ENV PUBLIC_CONVEX_URL=${PUBLIC_CONVEX_URL}
ENV VITE_RECIPIENT_ADDRESS=${VITE_RECIPIENT_ADDRESS}

# Build the application
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod

# Copy built application from builder stage
COPY --from=builder /app/build ./build

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Public environment variable for Convex
ENV PUBLIC_CONVEX_URL=""

# Expose the port
EXPOSE 3000

# Start the application
CMD ["node", "build"]
