# syntax=docker/dockerfile:1
FROM node:20-alpine

# sharp (image processing) needs these at runtime on alpine.
RUN apk add --no-cache vips

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Local-disk fallback for uploads/payment-proofs when S3_BUCKET isn't configured (see
# utils/objectStorage.js) — writable so a container without a mounted volume can still boot and
# serve a single instance; mount a volume here (or configure S3_BUCKET) before scaling past one.
RUN mkdir -p uploads payment-proofs

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
