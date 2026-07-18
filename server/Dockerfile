# Box Seat backend — long-lived Node service (SSE in, WebSocket out, SQLite on disk).
# Needs a persistent volume mounted where DB_PATH points, and the service wallet
# keypair provided at SERVICE_WALLET_PATH (mount as a secret file — never bake into
# the image).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp src/txline/idl/txoracle.json dist/txline/idl/txoracle.json

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/index.js"]
