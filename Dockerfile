# Base image
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* .npmrc* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app 
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV NODE_ENV=production

# Các biến môi trường
ENV MONGODB_URI="mongodb+srv://thanhthanh203203_db_user:27rPezV8s6lAfPa1@lhutuyensinh2025.tjrzsdi.mongodb.net/data?appName=LHUTuyenSinh2025"
ENV JWT_SECRET="A1412I8400R"
ENV GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----'
ENV GOOGLE_PROJECT_ID="systemair-441909"
ENV token='sys1'
# google drive chia sẻ drive để lưu
ENV GOOGLE_CLIENT_EMAIL='air-900@systemair-441909.iam.gserviceaccount.com'
ENV URL="http://localhost:4200/"

# Tạo user nextjs
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next
RUN chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# **Chỉnh port**
EXPOSE 4200
ENV PORT=4200
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
