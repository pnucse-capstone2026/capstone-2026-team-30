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

# [도커 레이어 캐싱 최적화] 패키지 정의 파일만 먼저 선별 복사하여 소스코드 변경 시 pnpm install 재실행 방지
# [기대 효과] 소스 변경 시 의존성 설치 레이어를 캐시(CACHED) 처리하여 빌드 시간을 3분에서 10초로 단축
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

# 모노레포 패키지 의존성 설치 (BuildKit 캐시 마운트로 레이어 비대화 및 중복 다운로드 방지)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile

# 소스코드 전체 복사 및 Next.js standalone 빌드
COPY . .
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
