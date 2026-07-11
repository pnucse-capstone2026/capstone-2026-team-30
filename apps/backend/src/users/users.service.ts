import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
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
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('User email already exists.');
    }

    const pwdHash = await argon2.hash(dto.password);

    return this.prisma.user.create({
      data: {
        email,
        pwdHash,
        role: dto.role,
      },
      select: USER_SELECT,
    });
  }

  async updateRole(
    userId: string,
    dto: UpdateUserRoleDto,
  ): Promise<UserResponse> {
    await this.ensureUserExists(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: USER_SELECT,
    });
  }

  async resetPassword(
    userId: string,
    dto: ResetUserPasswordDto,
  ): Promise<UserResponse> {
    await this.ensureUserExists(userId);

    const pwdHash = await argon2.hash(dto.password);

    return this.prisma.user.update({
      where: { id: userId },
      data: { pwdHash },
      select: USER_SELECT,
    });
  }

  async setDisabled(
    userId: string,
    dto: SetUserDisabledDto,
  ): Promise<UserResponse> {
    await this.ensureUserExists(userId);

    return this.prisma.user.update({
      where: { id: userId },
      data: { disabledAt: dto.disabled ? new Date() : null },
      select: USER_SELECT,
    });
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }
  }
}
