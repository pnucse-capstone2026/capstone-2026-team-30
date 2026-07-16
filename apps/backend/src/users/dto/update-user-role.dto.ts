import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UpdateUserRoleDto {
  @ApiProperty({ enum: Role, example: Role.APPROVER })
  @IsEnum(Role)
  role!: Role;
}
