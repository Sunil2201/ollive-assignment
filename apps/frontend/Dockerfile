FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# BACKEND_URL must be set at build time so next.config.mjs rewrites are compiled correctly
ENV BACKEND_URL=http://backend:5000

RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# standalone output bundles only what's needed to run
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# BACKEND_URL is read at server startup time by next.config.mjs rewrites
ENV BACKEND_URL=http://backend:5000

CMD ["node", "server.js"]