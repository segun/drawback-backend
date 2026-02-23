import { IsEnum } from 'class-validator';
import { UserMode } from '../enums/user-mode.enum';

export class SetUserModeDto {
  @IsEnum(UserMode)
  mode!: UserMode;
}
