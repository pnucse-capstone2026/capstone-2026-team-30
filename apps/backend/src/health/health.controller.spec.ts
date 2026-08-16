import { Test, TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { Response } from "express";
import { HttpStatus } from "@nestjs/common";

describe("HealthController", () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: {
            checkHealth: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    service = module.get<HealthService>(HealthService);
  });

  it("should return 200 OK when database is connected", async () => {
    const mockResult = {
      status: "ok" as const,
      database: "connected" as const,
      timestamp: "2026-08-18T12:00:00.000Z",
      uptimeSeconds: 100,
      environment: "test",
    };
    (service.checkHealth as jest.Mock).mockResolvedValue(mockResult);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    await controller.getHealth(res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(res.json).toHaveBeenCalledWith(mockResult);
  });

  it("should return 503 Service Unavailable when database is disconnected", async () => {
    const mockResult = {
      status: "error" as const,
      database: "disconnected" as const,
      timestamp: "2026-08-18T12:00:00.000Z",
      uptimeSeconds: 100,
      environment: "test",
    };
    (service.checkHealth as jest.Mock).mockResolvedValue(mockResult);

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    await controller.getHealth(res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(res.json).toHaveBeenCalledWith(mockResult);
  });
});
