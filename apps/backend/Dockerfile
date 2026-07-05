# Stage 1: Dependency Installation
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app

# 모노레포 의존성 파일 복사로 빌드속도 개선
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

# 락파일 기반 의존성 설치로 빌드 신뢰성 보장
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

# Prisma Client 코드 생성
RUN pnpm --filter @kyverno-platform/backend exec prisma generate

# 백엔드 빌드
RUN pnpm --filter @kyverno-platform/backend build

# Stage 3: Runner
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# 보안 설정
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# 런타임 실행 파일 및 의존 패키지만 선별 복사
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

USER nestjs

EXPOSE 3001

# 서버 실행
CMD ["node", "apps/backend/dist/main"]
