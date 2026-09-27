import { ApiProperty } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsString, MaxLength } from "class-validator";

/** 전체 교체 시맨틱. 빈 배열이면 모든 배정을 회수한다. */
export class SetUserClustersDto {
  @ApiProperty({ type: [String], example: ["prod", "staging"] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  clusterIds!: string[];
}
