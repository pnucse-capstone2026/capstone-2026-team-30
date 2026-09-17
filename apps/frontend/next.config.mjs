/** @type {import('next').NextConfig} */
const nextConfig = {
  // 프론트엔드가 shared 패키지의 소스코드를 빌드 타임에 해석할 수 있도록 모노레포 트랜스파일링 설정
  transpilePackages: ["@kyverno-platform/shared"],
  output: "standalone",
  // 런타임 동적 역방향 프록시는 App Router Route Handler (src/app/api/[...path]/route.ts)에서
  // 실시간 환경변수를 평가하여 처리하므로, 빌드 시점의 정적 rewrites를 제거하여 환경 간 이식성을 보장합니다.
};

export default nextConfig;
