import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { AiAgentController } from "./ai-agent.controller";
import { ExplainKyvernoErrorDto } from "./dto/explain-error.dto";

describe("AiAgentController", () => {
  it("protects endpoints with JWT and permission guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AiAgentController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it("declares policies.read permission on explainKyvernoError", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        AiAgentController.prototype.explainKyvernoError,
      ),
    ).toEqual(["policies.read"]);
  });

  it("delegates explainKyvernoError call to service with user context", async () => {
    const mockService = {
      explainKyvernoError: jest.fn().mockResolvedValue({
        summary: "해설 완료",
        resolutionSteps: [],
        suggestedFixYaml: null,
        governanceRationale: "보안 목적",
      }),
    };
    const controller = new AiAgentController(mockService as never);
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "developer@example.com",
      role: Role.REQUESTER,
      clusterIds: ["cluster-dev"],
    };
    const dto: ExplainKyvernoErrorDto = {
      errorMessage: "disallow-latest-tag rule violation",
      clusterId: "cluster-dev",
    };

    const res = await controller.explainKyvernoError(user, dto);

    expect(mockService.explainKyvernoError).toHaveBeenCalledWith(dto, user);
    expect(res.summary).toBe("해설 완료");
  });
});
