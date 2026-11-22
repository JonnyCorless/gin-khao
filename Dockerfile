# Single-service deploy: the Node server also serves the built web client.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci && npm run build -w @solanasmash/client

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 TRUST_PROXY=1
COPY --from=build /app /app
EXPOSE 8787
# CHAIN_MODE defaults to "mock" (no real funds). For devnet set CHAIN_MODE=solana, PROGRAM_ID, TREASURY, AUTHORITY_SECRET.
CMD ["npx", "tsx", "apps/server/src/index.ts"]
