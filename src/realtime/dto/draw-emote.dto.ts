import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * Allowed emojis for draw.emote events.
 * Must match the frontend emotes list.
 */
const ALLOWED_EMOJIS = [
  '❤️',
  '😂',
  '🔥',
  '👏',
  '😮',
  '💡',
  '🎉',
  '💯',
  '👍',
  '🥳',
  '😊',
  '😍',
  '🤗',
  '😎',
  '🤔',
  '😇',
  '🥺',
  '😢',
  '😭',
  '😡',
  '🤩',
  '😱',
  '🤯',
  '😴',
  '🤓',
  '🥰',
  '😘',
  '😜',
  '😋',
  '🤪',
  '🙌',
  '👋',
  '🤝',
  '💪',
  '🙏',
  '✨',
  '⭐',
  '🌟',
  '💫',
  '☀️',
  '🌈',
  '🎈',
  '🎊',
  '🎁',
  '🏆',
  '🥇',
  '💝',
  '💖',
  '💗',
  '💓',
  '✅',
  '❌',
  '⚡',
  '🚀',
  '🌺',
  '🌸',
  '🌻',
  '🌹',
  '🍕',
  '🍰',
] as const;

export class DrawEmoteDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsIn(ALLOWED_EMOJIS, {
    message: 'Invalid emoji. Must be one of the allowed emojis.',
  })
  emoji!: string;
}
