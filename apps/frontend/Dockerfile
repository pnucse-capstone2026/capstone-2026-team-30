# Stage 1: Builder
FROM node:22-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@latest-9 --activate

# 모노레포 전체 소스코드 복사
COPY . .

# 의존성 설치 및 Next.js standalone 빌드
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @kyverno-platform/frontend build

# Stage 2: Production Runner
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# 보안 유저 설정
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Standalone 번들 및 정적 파일 복사
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static

USER nextjs

EXPOSE 3000

# Next.js standalone 서버 실행
CMD ["node", "apps/frontend/server.js"]
