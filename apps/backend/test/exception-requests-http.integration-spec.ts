import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { ExceptionReconcilerService } from "../src/exception-lifecycle/exception-reconciler.service";
import { ClusterProvider } from "../src/kubernetes/cluster-provider";
import { PrismaService } from "../src/prisma/prisma.service";
import { seedRbacPermissions } from "../src/seed/rbac-seed.service";
import { buildFakeClusterProvider } from "./support/fake-cluster-provider";

const PASSWORD = "http-e2e-password";

describe("exception-requests HTTP e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "TEST_DATABASE_URL must be provided by the disposable PostgreSQL container.",
      );
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_ACCESS_SECRET = "http-e2e-access-secret";
    process.env.JWT_REFRESH_SECRET = "http-e2e-refresh-secret";
    process.env.JWT_ACCESS_EXPIRES_IN = "15m";
    process.env.JWT_REFRESH_EXPIRES_IN = "7d";

    const clusters = buildFakeClusterProvider([
      { id: "local", displayName: "Local", exceptionNamespace: "kyverno" },
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClusterProvider)
      .useValue(clusters)
      .overrideProvider(ExceptionReconcilerService)
      .useValue({ reconcileBatch: async () => undefined })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    await seedRbacPermissions(prisma);
    // User 를 참조하는 관계가 Restrict 이므로 afterAll 과 같은 순서로 지운다.
    await prisma.auditLog.deleteMany();
    await prisma.policyExceptionRequest.deleteMany();
    await prisma.user.deleteMany();
    await createUser("requester@example.com", Role.REQUESTER);
    await createUser("viewer@example.com", Role.VIEWER);
    await createUser("unassigned@example.com", Role.REQUESTER, []);
    await createUser("admin@example.com", Role.ADMIN, []);
  });

  afterAll(async () => {
    await prisma?.auditLog.deleteMany();
    await prisma?.policyExceptionRequest.deleteMany();
    await prisma?.user.deleteMany();
    await app?.close();
  });

  const server = () => app.getHttpServer();

  it("rejects unauthenticated requests with 401", async () => {
    await request(server()).post("/exception-requests").send({}).expect(401);
  });

  it("creates a request for an authorized REQUESTER", async () => {
    const token = await login("requester@example.com");
    const response = await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload())
      .expect(201);

    expect(response.body).toMatchObject({
      status: "PENDING",
      targetClusterId: "local",
      targetClusterDisplayName: "Local",
    });
    await expect(
      prisma.policyExceptionRequest.findUnique({
        where: { id: response.body.id },
      }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("forbids a VIEWER from creating a request with 403", async () => {
    const token = await login("viewer@example.com");
    await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload())
      .expect(403);
  });

  it("returns 404 for an unconfigured target cluster", async () => {
    const token = await login("requester@example.com");
    await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validPayload(), targetClusterId: "does-not-exist" })
      .expect(404);
  });

  it("returns 404 when the requester has no assignment for the cluster", async () => {
    const token = await login("unassigned@example.com");
    await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload())
      .expect(404);
  });

  it("hides clusters the user is not assigned to", async () => {
    const token = await login("unassigned@example.com");
    const response = await request(server())
      .get("/clusters")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it("rejects an invalid payload with 400", async () => {
    const token = await login("requester@example.com");
    await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...validPayload(), ruleNames: [], unexpectedField: "x" })
      .expect(400);
  });

  it("lists clusters as metadata without credentials", async () => {
    const token = await login("requester@example.com");
    const response = await request(server())
      .get("/clusters")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual([
      { id: "local", displayName: "Local", exceptionNamespace: "kyverno" },
    ]);
    expect(response.body[0]).not.toHaveProperty("customObjectsApi");
  });

  it("applies admin self-assignment and revocation without issuing a new token", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: "admin@example.com" },
    });
    const token = await login(admin.email);

    await request(server())
      .get("/clusters")
      .set("Authorization", `Bearer ${token}`)
      .expect(200, []);

    const catalog = await request(server())
      .get("/clusters/catalog")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(catalog.body).toEqual([
      { id: "local", displayName: "Local", exceptionNamespace: "kyverno" },
    ]);

    await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload())
      .expect(404);

    await request(server())
      .put(`/users/${admin.id}/clusters`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clusterIds: ["local"] })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ id: admin.id, clusterIds: ["local"] });
      });

    const created = await request(server())
      .post("/exception-requests")
      .set("Authorization", `Bearer ${token}`)
      .send(validPayload())
      .expect(201);

    await request(server())
      .put(`/users/${admin.id}/clusters`)
      .set("Authorization", `Bearer ${token}`)
      .send({ clusterIds: [] })
      .expect(200);

    await request(server())
      .get(`/exception-requests/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("forbids callers without assignment permission from reading the catalog", async () => {
    const token = await login("requester@example.com");
    await request(server())
      .get("/clusters/catalog")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  // 클러스터 스코프가 deny-by-default 라 테스트 사용자에게도 배정이 필요하다.
  async function createUser(
    email: string,
    role: Role,
    clusterIds: string[] = ["local"],
  ): Promise<void> {
    await prisma.user.create({
      data: {
        email,
        pwdHash: await argon2.hash(PASSWORD),
        role,
        userClusters: {
          create: clusterIds.map((clusterId) => ({ clusterId })),
        },
      },
    });
  }

  async function login(email: string): Promise<string> {
    const response = await request(server())
      .post("/auth/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.accessToken;
  }

  function validPayload() {
    return {
      policyName: "disallow-latest-tag",
      ruleNames: ["validate-image-tag"],
      reason: "http e2e",
      resourceKind: "Deployment",
      resourceName: "api",
      resourceNamespace: "production",
      targetClusterId: "local",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }
});
