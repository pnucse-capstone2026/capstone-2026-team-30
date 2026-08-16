import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class ApproveExceptionRequestDto {
  @ApiPropertyOptional({
    type: [String],
    description: "Approved subset of the originally requested rules.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  ruleNames?: string[];

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  decisionNote?: string;
}
