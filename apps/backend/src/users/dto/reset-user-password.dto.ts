import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class ResetUserPasswordDto {
  @ApiProperty({ example: "new-change-this-password" })
  @IsString()
  @MinLength(1)
  password!: string;
}
