import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import { PrismaModule } from "./prisma.module";
import { PRISMA_ERROR_CODE, PrismaErrorCode } from "./prisma-error";
import { PrismaService } from "./prisma.service";

function createPrismaError(code: PrismaErrorCode) {
  return new Prisma.PrismaClientKnownRequestError("Prisma request failed.", {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe("PrismaService", () => {
  let service: PrismaService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    service = moduleRef.get(PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("is provided by PrismaModule", () => {
    expect(service).toBeDefined();
    expect(service.onModuleInit).toEqual(expect.any(Function));
    expect(service.onModuleDestroy).toEqual(expect.any(Function));
  });

  it("connects during module initialization", async () => {
    const connect = jest
      .spyOn(service, "$connect")
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects during module destruction", async () => {
    const disconnect = jest
      .spyOn(service, "$disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("runs callbacks in a serializable transaction", async () => {
    const transaction = {
      marker: "transaction-client",
    } as unknown as Prisma.TransactionClient;
    const operation = jest.fn().mockResolvedValue("transaction-result");
    const runTransaction = jest
      .spyOn(service, "$transaction")
      .mockImplementation(async (callback, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });

        return callback(transaction);
      });

    await expect(service.runSerializableTransaction(operation)).resolves.toBe(
      "transaction-result",
    );
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(transaction);
  });

  it("retries P2034 conflicts up to the third attempt", async () => {
    const transactionError = createPrismaError(
      PRISMA_ERROR_CODE.TRANSACTION_CONFLICT,
    );
    const runTransaction = jest
      .spyOn(service, "$transaction")
      .mockRejectedValueOnce(transactionError)
      .mockRejectedValueOnce(transactionError)
      .mockResolvedValueOnce("transaction-result" as never);

    await expect(service.runSerializableTransaction(jest.fn())).resolves.toBe(
      "transaction-result",
    );
    expect(runTransaction).toHaveBeenCalledTimes(3);
  });

  it("stops retrying after three P2034 conflicts", async () => {
    const transactionError = createPrismaError(
      PRISMA_ERROR_CODE.TRANSACTION_CONFLICT,
    );
    const runTransaction = jest
      .spyOn(service, "$transaction")
      .mockRejectedValue(transactionError);

    await expect(service.runSerializableTransaction(jest.fn())).rejects.toBe(
      transactionError,
    );
    expect(runTransaction).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-transaction-conflict errors", async () => {
    const databaseError = new Error("database unavailable");
    const runTransaction = jest
      .spyOn(service, "$transaction")
      .mockRejectedValue(databaseError);

    await expect(service.runSerializableTransaction(jest.fn())).rejects.toBe(
      databaseError,
    );
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });
});
