import { IsBoolean } from 'class-validator';

export class RespondChatRequestDto {
  @IsBoolean()
  accept!: boolean;
}
