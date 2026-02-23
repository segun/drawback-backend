import { IsString, Matches } from 'class-validator';

export class CreateChatRequestDto {
  @IsString()
  @Matches(/^@[a-zA-Z0-9_]{3,29}$/, {
    message: 'toDisplayName must be a valid @username',
  })
  toDisplayName!: string;
}
