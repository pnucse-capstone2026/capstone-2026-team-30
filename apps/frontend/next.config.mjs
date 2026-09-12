/** @type {import('next').NextConfig} */
const nextConfig = {
  // 프론트엔드가 shared 패키지의 소스코드를 빌드 타임에 해석할 수 있도록 모노레포 트랜스파일링 설정
  transpilePackages: ["@kyverno-platform/shared"],
  output: "standalone",
  async rewrites() {
    const backendUrl =
      process.env.INTERNAL_BACKEND_URL ||
      process.env.BACKEND_URL ||
      (process.env.KUBERNETES_SERVICE_HOST
        ? "http://kyverno-backend.kyverno-platform.svc.cluster.local:3001"
        : "http://127.0.0.1:3001");
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
      {
        source: "/notebook/:path*",
        destination: `${backendUrl}/notebook/:path*`,
      },
    ];
  },
};

export default nextConfig;
