import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { revokeAllRefreshTokensForUser } from '../auth/refresh-token-revocation';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { SetUserDisabledDto } from './dto/set-user-disabled.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

type UserResponse = {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
};

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UserResponse[]> {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateUserDto): Promise<UserResponse> {
    const email = dto.email.trim().toLowerCase();
    const pwdHash = await argon2.hash(dto.password);

    try {
      return await this.prisma.user.create({
        data: {
          email,
          pwdHash,
          role: dto.role,
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException('User email already exists.');
      }

      throw error;
    }
  }

  async updateRole(
    userId: string,
    dto: UpdateUserRoleDto,
  ): Promise<UserResponse> {
    return this.updateExistingUser(() =>
      this.prisma.user.update({
        where: { id: userId },
        data: { role: dto.role },
        select: USER_SELECT,
      }),
    );
  }

  async resetPassword(
    userId: string,
    dto: ResetUserPasswordDto,
  ): Promise<UserResponse> {
    const pwdHash = await argon2.hash(dto.password);

    return this.updateUserAndRevokeSessions(userId, (transaction) =>
      transaction.user.update({
        where: { id: userId },
        data: { pwdHash },
        select: USER_SELECT,
      }),
    );
  }

  async setDisabled(
    userId: string,
    dto: SetUserDisabledDto,
  ): Promise<UserResponse> {
    if (dto.disabled) {
      return this.updateUserAndRevokeSessions(userId, (transaction) =>
        transaction.user.update({
          where: { id: userId },
          data: { disabledAt: new Date() },
          select: USER_SELECT,
        }),
      );
    }

    return this.updateExistingUser(() =>
      this.prisma.user.update({
        where: { id: userId },
        data: { disabledAt: null },
        select: USER_SELECT,
      }),
    );
  }

  private async updateUserAndRevokeSessions(
    userId: string,
    operation: (
      transaction: Prisma.TransactionClient,
    ) => Promise<UserResponse>,
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
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('User not found.');
      }

      throw error;
    }
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
