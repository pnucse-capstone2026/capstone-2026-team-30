# 빌드 환경 일관성 유지 및 경량화를 위해 Node.js 22 glibc slim 베이스 이미지 설정
FROM node:22-slim AS base
WORKDIR /app

# pnpm 사용 환경 구축 및 텔레메트리 비활성화로 빌드 풋프린트 축소
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@latest-9 --activate

# Next.js standalone 빌드를 수행하는 Builder 스테이지
FROM base AS builder
WORKDIR /app

# 모노레포 전체 소스코드 복사
COPY . .

# 의존성 설치 및 Next.js 15 standalone 프로덕션 아티팩트 생성
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @kyverno-platform/frontend build

# 150MB 미만의 경량 런타임 환경 구성을 위한 Runner 스테이지
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# 보안 강화를 위한 non-root 사용자 및 그룹 설정
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Next.js standalone 번들, static 자원, public 에셋만 최소한으로 복사하여 이미지 크기 최적화 (<150MB)
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static

USER nextjs

EXPOSE 3000

# Next.js standalone 경량 서버 구동
CMD ["node", "apps/frontend/server.js"]

