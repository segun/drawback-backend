export class SocketInfoDto {
  userId!: string;
  userEmail!: string;
  userDisplayName!: string;
  socketId!: string;
  connectedAt!: string;
  currentRoom!: string | null;
  ipAddress!: string;
  userAgent!: string;
}
