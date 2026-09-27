import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CiOrJwtAuthGuard } from "./ci-or-jwt-auth.guard";
import { BusinessException } from "../../common/errors/business.exception";
import { GITOPS_ERROR } from "../gitops.errors";
import { AUTH_ERROR } from "../../auth/auth.errors";

describe("CiOrJwtAuthGuard", () => {
  let guard: CiOrJwtAuthGuard;
  let mockConfigService: { get: jest.Mock };

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === "GITOPS_CI_TOKEN" || key === "CI_API_KEY") {
          return "test-ci-secret-token";
        }
        return undefined;
      }),
    };

    guard = new CiOrJwtAuthGuard(mockConfigService as unknown as ConfigService);
  });

  function createMockContext(
    headers: Record<string, string>,
  ): ExecutionContext {
    const request = {
      headers,
      user: undefined,
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it("should authenticate and inject ci-bot user when valid X-CI-Token is provided", async () => {
    const context = createMockContext({ "x-ci-token": "test-ci-secret-token" });
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string; role: string } }>();
    expect(request.user).toBeDefined();
    expect(request.user?.id).toBe("ci-bot");
    expect(request.user?.role).toBe("ADMIN");
  });

  it("should throw UNAUTHORIZED_CI_TOKEN when X-CI-Token is incorrect", async () => {
    const context = createMockContext({ "x-ci-token": "wrong-token" });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new BusinessException(GITOPS_ERROR.UNAUTHORIZED_CI_TOKEN),
    );
  });

  it("should delegate to JWT guard when Bearer token is provided", async () => {
    const context = createMockContext({
      authorization: "Bearer valid.jwt.token",
    });

    // super.canActivate를 모킹하여 JWT 성공 시뮬레이션
    const superCanActivateSpy = jest
      .spyOn(Object.getPrototypeOf(CiOrJwtAuthGuard.prototype), "canActivate")
      .mockResolvedValueOnce(true);

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    superCanActivateSpy.mockRestore();
  });

  it("should throw AUTHENTICATION_REQUIRED when no credentials are provided", async () => {
    const context = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(
      new BusinessException(AUTH_ERROR.AUTHENTICATION_REQUIRED),
    );
  });
});
