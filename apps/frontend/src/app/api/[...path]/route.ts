import { NextRequest } from "next/server";
import { forwardToBackend } from "@/lib/runtime-proxy";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

/**
 * Next.js App Router API Catch-All 런타임 역방향 프록시 핸들러
 *
 * 브라우저의 모든 /api/* 요청을 가로채 런타임 환경변수에 지정된 백엔드로 동적 중계합니다.
 * Next.js 빌드 시점 정적 rewrite 고정 문제를 원천 해소합니다.
 */
async function handleRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const subPath = `api/${path.join("/")}`;
  return forwardToBackend(request, subPath);
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const HEAD = handleRequest;
export const OPTIONS = handleRequest;
