import { IsUUID } from 'class-validator';

export class JoinGroupDto {
  @IsUUID()
  groupId!: string;
}
