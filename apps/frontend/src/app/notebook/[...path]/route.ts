import { NextRequest } from "next/server";
import { forwardToBackend } from "@/lib/runtime-proxy";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

/**
 * Kubeflow Jupyter Notebook 인브라우저 접근용 Catch-All 런타임 역방향 프록시 핸들러
 *
 * 브라우저의 모든 /notebook/* 요청을 런타임 환경변수의 백엔드 Jupyter 프록시 서비스로 중계합니다.
 */
async function handleRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const subPath = `notebook/${path.join("/")}`;
  return forwardToBackend(request, subPath);
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
export const HEAD = handleRequest;
export const OPTIONS = handleRequest;
