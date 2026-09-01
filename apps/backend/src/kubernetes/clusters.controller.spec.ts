import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ClusterProvider } from "./cluster-provider";
import { ClustersController } from "./clusters.controller";

describe("ClustersController", () => {
  it("protects the endpoint with JWT and permission guards", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ClustersController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it("declares the permissions for the scoped list and full catalog", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ClustersController.prototype.list,
      ),
    ).toEqual(["exception_requests.read"]);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ClustersController.prototype.catalog,
      ),
    ).toEqual(["users.assign_clusters"]);
    expect(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ClustersController.prototype.get,
      ),
    ).toEqual(["exception_requests.read"]);
  });

  const metadata = [
    { id: "prod", displayName: "Production", exceptionNamespace: "kyverno" },
    { id: "staging", displayName: "Staging", exceptionNamespace: "kyverno" },
  ];

  function controllerWith() {
    const clusters = {
      list: jest.fn(() => metadata),
      getMetadata: jest.fn(
        (id: string) =>
          metadata.find((m) => m.id === id) ?? {
            id,
            displayName: id,
            exceptionNamespace: "kyverno",
          },
      ),
    } as unknown as ClusterProvider;
    const clusterOverviewService = {
      getLiveOverview: jest.fn(),
    } as never;
    return {
      controller: new ClustersController(clusters, clusterOverviewService),
      clusters,
    };
  }

  function user(role: Role, clusterIds: string[]): AuthenticatedUser {
    return { id: "u", email: "u@example.com", role, clusterIds };
  }

  it("returns nothing to an admin with no assignment", () => {
    const { controller, clusters } = controllerWith();

    expect(controller.list(user(Role.ADMIN, []))).toEqual([]);
    expect(clusters.list).toHaveBeenCalledTimes(1);
  });

  it("returns only the clusters assigned to any role", () => {
    const { controller } = controllerWith();

    expect(controller.list(user(Role.APPROVER, ["staging"]))).toEqual([
      metadata[1],
    ]);
  });

  it("returns nothing to a non-admin with no assignment", () => {
    const { controller } = controllerWith();

    expect(controller.list(user(Role.VIEWER, []))).toEqual([]);
  });

  it("returns the full catalog independently of caller assignments", () => {
    const { controller } = controllerWith();

    expect(controller.catalog()).toEqual(metadata);
  });

  it("returns cluster metadata by id when assigned or having permissions", () => {
    const { controller, clusters } = controllerWith();

    expect(controller.get("staging", user(Role.VIEWER, ["staging"]))).toEqual(
      metadata[1],
    );
    expect(clusters.getMetadata).toHaveBeenCalledWith("staging");

    expect(controller.get("prod", user(Role.ADMIN, []))).toEqual(metadata[0]);
  });

  it("throws when accessing cluster without assignment and permission", () => {
    const { controller } = controllerWith();

    expect(() =>
      controller.get("prod", user(Role.VIEWER, ["staging"])),
    ).toThrow();
  });
});
