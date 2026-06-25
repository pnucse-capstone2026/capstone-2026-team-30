/** @type {import('next').NextConfig} */
const nextConfig = {
  // 모노레포에서 shared 패키지를 transpile
  transpilePackages: ["@kyverno-platform/shared"],
};

export default nextConfig;
