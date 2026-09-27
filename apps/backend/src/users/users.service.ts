import { Injectable } from "@nestjs/common";
import { AuditActorType, Prisma, Role } from "@prisma/client";
import argon2 from "argon2";
import { AuthenticatedUser } from "../auth/auth.types";
import { revokeAllRefreshTokensForUser } from "../auth/refresh-token-revocation";
import { BusinessException } from "../common/errors/business.exception";
import {
  isPrismaKnownRequestError,
  PRISMA_ERROR_CODE,
} from "../prisma/prisma-error";
import { ClusterProvider } from "../kubernetes/cluster-provider";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { ResetUserPasswordDto } from "./dto/reset-user-password.dto";
import { SetUserClustersDto } from "./dto/set-user-clusters.dto";
import { SetUserDisabledDto } from "./dto/set-user-disabled.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";
import { USER_ERROR } from "./user.errors";

type UserResponse = {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
  clusterIds: string[];
};

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
  userClusters: {
    select: { clusterId: true },
    orderBy: { clusterId: "asc" },
  },
} as const;

type SelectedUser = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function toUserResponse(user: SelectedUser): UserResponse {
  const { userClusters, ...response } = user;
  return {
    ...response,
    clusterIds: userClusters.map((assignment) => assignment.clusterId),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clusters: ClusterProvider,
  ) {}

  /**
   * 배정을 전체 교체한다. 클러스터는 DB 엔티티가 아니라 설정값이므로 FK 대신
   * ClusterProvider 로 존재를 확인한다 — 없는 id 는 CLUSTER_NOT_CONFIGURED 로 거절된다.
   */
  async setClusters(
    id: string,
    dto: SetUserClustersDto,
    actor: AuthenticatedUser,
  ): Promise<UserResponse> {
    const clusterIds = [
      ...new Set(dto.clusterIds.map((value) => value.trim())),
    ].sort();
    for (const clusterId of clusterIds) {
      this.clusters.getMetadata(clusterId);
    }

    return this.prisma.runSerializableTransaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: USER_SELECT,
      });
      if (!user) {
        throw new BusinessException(USER_ERROR.NOT_FOUND, {
          context: { userId: id },
        });
      }

      const current = toUserResponse(user);
      if (
        current.clusterIds.length === clusterIds.length &&
        current.clusterIds.every(
          (clusterId, index) => clusterId === clusterIds[index],
        )
      ) {
        return current;
      }

      await tx.userCluster.deleteMany({ where: { userId: id } });
      if (clusterIds.length) {
        await tx.userCluster.createMany({
          data: clusterIds.map((clusterId) => ({ userId: id, clusterId })),
        });
      }

      await tx.auditLog.create({
        data: {
          action: "USER_CLUSTER_ASSIGNMENTS_UPDATED",
          entityType: "User",
          entityId: id,
          actorType: AuditActorType.USER,
          userId: actor.id,
          metadata: {
            beforeClusterIds: current.clusterIds,
            afterClusterIds: clusterIds,
          },
        },
      });

      return { ...current, clusterIds };
    });
  }

  async list(): Promise<UserResponse[]> {
    const users = await this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return users.map(toUserResponse);
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const email = dto.email.trim().toLowerCase();
    const pwdHash = await argon2.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          pwdHash,
          role: dto.role,
        },
        select: USER_SELECT,
      });
      return toUserResponse(user);
    } catch (error) {
      if (
        isPrismaKnownRequestError(
          error,
          PRISMA_ERROR_CODE.UNIQUE_CONSTRAINT_VIOLATION,
        )
      ) {
        throw new BusinessException(USER_ERROR.EMAIL_ALREADY_EXISTS, {
          cause: error,
          context: { email },
        });
      }

      throw error;
    }
  }

  async updateRole(
    userId: string,
    dto: UpdateUserRoleDto,
  ): Promise<UserResponse> {
    return this.updateExistingUser(async () =>
      toUserResponse(
        await this.prisma.user.update({
          where: { id: userId },
          data: { role: dto.role },
          select: USER_SELECT,
        }),
      ),
    );
  }

  async resetPassword(
    userId: string,
    dto: ResetUserPasswordDto,
  ): Promise<UserResponse> {
    const pwdHash = await argon2.hash(dto.password);

    return this.updateUserAndRevokeSessions(userId, async (transaction) =>
      toUserResponse(
        await transaction.user.update({
          where: { id: userId },
          data: { pwdHash },
          select: USER_SELECT,
        }),
      ),
    );
  }

  async setDisabled(
    userId: string,
    dto: SetUserDisabledDto,
  ): Promise<UserResponse> {
    if (dto.disabled) {
      return this.updateUserAndRevokeSessions(userId, async (transaction) =>
        toUserResponse(
          await transaction.user.update({
            where: { id: userId },
            data: { disabledAt: new Date() },
            select: USER_SELECT,
          }),
        ),
      );
    }

    return this.updateExistingUser(async () =>
      toUserResponse(
        await this.prisma.user.update({
          where: { id: userId },
          data: { disabledAt: null },
          select: USER_SELECT,
        }),
      ),
    );
  }

  private async updateUserAndRevokeSessions(
    userId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<UserResponse>,
  ): Promise<UserResponse> {
    return this.updateExistingUser(() =>
      this.prisma.runSerializableTransaction(async (transaction) => {
        const updatedUser = await operation(transaction);

        await revokeAllRefreshTokensForUser(transaction, userId);

        return updatedUser;
      }),
    );
  }

  private async updateExistingUser(
    operation: () => Promise<UserResponse>,
  ): Promise<UserResponse> {
    try {
      return await operation();
    } catch (error) {
      if (
        isPrismaKnownRequestError(error, PRISMA_ERROR_CODE.RECORD_NOT_FOUND)
      ) {
        throw new BusinessException(USER_ERROR.NOT_FOUND, {
          cause: error,
        });
      }

      throw error;
    }
  }
}
