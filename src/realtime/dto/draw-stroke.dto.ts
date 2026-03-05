import {
  IsUUID,
  ValidateNested,
  IsString,
  IsNumber,
  Min,
  Max,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

class PointDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}

class StrokeDataDto {
  @IsString()
  @MaxLength(20)
  kind!: string;

  @ValidateNested()
  @Type(() => PointDto)
  from!: PointDto;

  @ValidateNested()
  @Type(() => PointDto)
  to!: PointDto;

  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Color must be a valid hex color' })
  color!: string;

  @IsNumber()
  @Min(1)
  @Max(100)
  width!: number;

  @IsString()
  @MaxLength(20)
  style!: string;
}

export class DrawStrokeDto {
  @IsUUID()
  requestId!: string;

  @ValidateNested()
  @Type(() => StrokeDataDto)
  stroke!: StrokeDataDto;
}
