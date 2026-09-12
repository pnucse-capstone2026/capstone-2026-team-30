import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GitOpsController } from "./gitops.controller";
import { GitOpsService } from "./gitops.service";
import { GitOpsPrReviewDto } from "./dto/gitops-pr-review.dto";

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn(),
}));

describe("GitOpsController", () => {
  let controller: GitOpsController;
  let service: { reviewPullRequest: jest.Mock };

  beforeEach(async () => {
    service = {
      reviewPullRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GitOpsController],
      providers: [
        { provide: GitOpsService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("mock-token") },
        },
      ],
    }).compile();

    controller = module.get<GitOpsController>(GitOpsController);
  });

  it("should delegate reviewPullRequest to GitOpsService", async () => {
    const dto: GitOpsPrReviewDto = {
      repository: "org/repo",
      pullNumber: 10,
      commitSha: "sha123",
      targetNamespace: "default",
      manifestYaml: "apiVersion: v1\nkind: Pod",
    };

    const expectedResult = {
      valid: true,
      blocked: false,
      totalResources: 1,
      blockedCount: 0,
      status: "PASSED" as const,
      violations: [],
    };

    service.reviewPullRequest.mockResolvedValueOnce(expectedResult);

    const result = await controller.reviewPullRequest(dto);
    expect(result).toEqual(expectedResult);
    expect(service.reviewPullRequest).toHaveBeenCalledWith(dto);
  });
});
