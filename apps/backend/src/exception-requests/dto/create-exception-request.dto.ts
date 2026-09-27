import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateExceptionRequestDto {
  @ApiProperty({ example: "disallow-latest-tag" })
  @IsString()
  @MaxLength(253)
  policyName!: string;

  @ApiProperty({ type: [String], example: ["validate-image-tag"] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  ruleNames!: string[];

  @ApiProperty({ example: "Emergency production rollback" })
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiProperty({ example: "Deployment" })
  @IsString()
  @MaxLength(63)
  resourceKind!: string;

  @ApiProperty({ example: "api" })
  @IsString()
  @MaxLength(253)
  resourceName!: string;

  @ApiPropertyOptional({ example: "production", nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  resourceNamespace?: string;

  @ApiProperty({ example: "default" })
  @IsString()
  @MaxLength(128)
  targetClusterId!: string;

  @ApiProperty({ example: "2026-08-01T00:00:00.000Z" })
  @IsDateString({ strict: true })
  expiresAt!: string;
}
