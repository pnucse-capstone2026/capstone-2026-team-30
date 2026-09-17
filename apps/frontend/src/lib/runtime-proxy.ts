import { NextRequest, NextResponse } from "next/server";

/**
 * 런타임 환경에 따라 유효한 백엔드 API 기본 주소를 결정합니다.
 *
 * 빌드 타임에 정적으로 고정되지 않고, 매 요청마다 프로세스 환경 변수를 참조하여
 * 로컬 개발, Kind(로컬 클러스터), AWS EKS 환경 간의 원활한 동적 전환을 보장합니다.
 *
 * @returns 백엔드 API 기본 베이스 URL (끝 슬래시 제외)
 */
export function getInternalBackendUrl(): string {
  if (process.env.INTERNAL_BACKEND_URL) {
    return process.env.INTERNAL_BACKEND_URL.replace(/\/+$/, "");
  }
  if (process.env.BACKEND_URL) {
    return process.env.BACKEND_URL.replace(/\/+$/, "");
  }
  // 로컬 개발 환경(npm run dev / next dev)에서는 로컬 백엔드로 자동 라우팅
  if (process.env.NODE_ENV === "development") {
    return "http://127.0.0.1:3001";
  }
  // 쿠버네티스 프로덕션 기본 서비스 DNS
  return "http://kyverno-backend.kyverno-platform.svc.cluster.local:3001";
}

/**
 * 브라우저 클라이언트의 요청을 내부 백엔드 서비스로 투명하게 중계(Reverse Proxy)합니다.
 *
 * - 모든 HTTP 메서드, 쿼리 파라미터, 스트리밍 바디를 안전하게 전달
 * - 인증 쿠키(Set-Cookie) 다중 헤더 및 CORS 헤더 온전한 보존
 * - 빌드 시점이 아닌 런타임 환경변수 실시간 평가를 통한 환경 간 이식성 확보
 *
 * @param request 들어온 NextRequest 객체
 * @param subPath 백엔드로 전달할 서브 경로 (예: 'api/auth/login', 'notebook/hub')
 * @returns 백엔드 서비스의 응답을 래핑한 NextResponse 객체
 */
export async function forwardToBackend(
  request: NextRequest,
  subPath: string,
): Promise<NextResponse> {
  const backendBase = getInternalBackendUrl();
  const search = request.nextUrl.search;
  const targetUrl = `${backendBase}/${subPath}${search}`;

  const headers = new Headers(request.headers);
  const targetHost = new URL(backendBase).host;
  headers.set("host", targetHost);
  headers.set("x-forwarded-host", request.headers.get("host") || targetHost);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (hasBody && request.body) {
      fetchOptions.body = request.body;
      // @ts-ignore Node.js / Next.js fetch 스트리밍 duplex 옵션
      fetchOptions.duplex = "half";
    }

    const backendResponse = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers(backendResponse.headers);

    // Set-Cookie 다중 헤더 누락 방지 처리
    if (typeof backendResponse.headers.getSetCookie === "function") {
      const setCookies = backendResponse.headers.getSetCookie();
      if (setCookies && setCookies.length > 0) {
        responseHeaders.delete("set-cookie");
        setCookies.forEach((cookie) => {
          responseHeaders.append("set-cookie", cookie);
        });
      }
    }

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(
      `[RuntimeProxy] Failed to proxy request to ${targetUrl}:`,
      error,
    );
    return NextResponse.json(
      {
        statusCode: 502,
        error: "Bad Gateway",
        message: `Failed to connect to backend at ${backendBase}. Please ensure the backend is running.`,
      },
      { status: 502 },
    );
  }
}
