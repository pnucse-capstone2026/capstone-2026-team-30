# Stage 1: Builder
FROM node:22-slim AS builder
WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

RUN corepack enable && corepack prepare pnpm@latest-9 --activate

# 모노레포 전체 소스코드 복사
COPY . .

# 의존성 설치 및 공유 라이브러리, Prisma 코드 생성, 백엔드 빌드
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @kyverno-platform/shared build
RUN pnpm --filter @kyverno-platform/backend exec prisma generate
RUN pnpm --filter @kyverno-platform/backend build

# Stage 2: Production Runner
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# 보안 유저 설정
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# 실행 파일 및 런타임 파일 복사
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

USER nestjs

EXPOSE 3001

# NestJS 서버 실행
CMD ["node", "apps/backend/dist/main"]
