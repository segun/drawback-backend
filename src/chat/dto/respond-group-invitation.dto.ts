import { IsBoolean } from 'class-validator';

export class RespondGroupInvitationDto {
  @IsBoolean()
  accept!: boolean;
}
