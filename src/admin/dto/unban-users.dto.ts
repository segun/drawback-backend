import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class UnbanUsersDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  userIds!: string[];
}
