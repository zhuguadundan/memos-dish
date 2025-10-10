# Multi-stage build: frontend (pnpm) → backend (Go) → runtime (Alpine)

# 1) Build frontend assets into server/router/frontend/dist
FROM node:22-alpine AS frontend
WORKDIR /workspace/web

# Use corepack for pnpm without touching host
RUN corepack enable

# Install deps with lockfile for reproducibility
COPY web/package.json web/pnpm-lock.yaml ./
# Lockfile appears out of date in repo; allow regeneration during build
RUN pnpm install --no-frozen-lockfile

# Build release artifacts into ../server/router/frontend/dist
COPY web/ .
# Ensure target parent directory exists
RUN mkdir -p /workspace/server/router/frontend
RUN pnpm release


# 2) Build Go backend with embedded frontend assets
FROM golang:1.25-alpine AS backend
WORKDIR /backend-build

# Dependencies first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy full repo (without heavy ignored files thanks to .dockerignore)
COPY . .

# Bring in the built frontend assets before compiling so go:embed can pick them up
COPY --from=frontend /workspace/server/router/frontend/dist ./server/router/frontend/dist

# Build minimal binary
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -ldflags="-s -w" -o memos ./bin/memos/main.go


# 3) Runtime image
FROM alpine:3.20 AS runner
WORKDIR /usr/local/memos

RUN apk add --no-cache tzdata ca-certificates && update-ca-certificates
ENV TZ="UTC"

COPY --from=backend /backend-build/memos /usr/local/memos/
COPY scripts/entrypoint.sh /usr/local/memos/

EXPOSE 5230

# Data directory (mount point)
RUN mkdir -p /var/opt/memos
VOLUME /var/opt/memos

ENV MEMOS_MODE="prod"
ENV MEMOS_PORT="5230"

# Normalize Windows line endings to Unix and ensure executable bit
RUN sed -i 's/\r$//' /usr/local/memos/entrypoint.sh \
    && chmod +x /usr/local/memos/entrypoint.sh

ENTRYPOINT ["./entrypoint.sh", "./memos"]
