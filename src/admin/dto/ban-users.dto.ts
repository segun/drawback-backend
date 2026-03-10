import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BanUsersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  userIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
