export class SocketInfoDto {
  userId!: string;
  socketId!: string;
  connectedAt!: string;
  currentRoom!: string | null;
  ipAddress!: string;
  userAgent!: string;
}
