import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";

export class CreateUserDto {
  @ApiProperty({ example: "requester@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "change-this-password" })
  @IsString()
  @MinLength(1)
  password!: string;

  @ApiProperty({ enum: Role, example: Role.REQUESTER })
  @IsEnum(Role)
  role!: Role;
}
