import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetUserDisabledDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  disabled!: boolean;
}
