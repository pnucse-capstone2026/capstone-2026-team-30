# 빌드 및 런타임 환경 일관성을 확보하고 컨테이너 용량을 최소화하기 위해 Node.js 22 glibc slim 베이스 이미지 설정
FROM node:22-slim AS base
WORKDIR /app

# pnpm 패키지 매니저 활성화 및 패키지 실행 경로 환경변수 구성
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

RUN corepack enable && corepack prepare pnpm@latest-9 --activate

# 의존성 설치 및 애플리케이션 빌드를 위한 Builder 스테이지
FROM base AS builder
WORKDIR /app

# [도커 레이어 캐싱 최적화] 패키지 정의 파일만 먼저 선별 복사하여 소스코드 변경 시 pnpm install 재실행 방지
# [기대 효과] 소스 변경 시 의존성 설치 레이어를 캐시(CACHED) 처리하여 빌드 시간을 3분에서 10초로 단축
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

# 모노레포 패키지 의존성 설치
RUN pnpm install --no-frozen-lockfile

# 소스코드 전체 복사 및 애플리케이션 빌드
COPY . .

# 모노레포 공통 라이브러리 빌드 및 Prisma 클라이언트 생성
RUN pnpm --filter @kyverno-platform/shared build
RUN pnpm --filter @kyverno-platform/backend exec prisma generate

# NestJS 백엔드 생산용 아티팩트 빌드
RUN pnpm --filter @kyverno-platform/backend build

# 프로덕션 서버 실행만을 위한 경량화 런타임 Runner 스테이지
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# 최소 권한 보안 원칙 준수를 위한 non-root 전용 사용자 계정 구성
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# 빌드 결과물 및 런타임 필수 패키지만 선별 복사하여 최종 컨테이너 이미지 크기 축소
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/prisma ./apps/backend/prisma
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

USER nestjs

EXPOSE 3001

# NestJS 백엔드 어플리케이션 진입점 실행
CMD ["node", "apps/backend/dist/main"]
