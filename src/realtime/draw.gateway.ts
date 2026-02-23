import {
  Inject,
  Logger,
  OnModuleInit,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis, { RedisOptions } from 'ioredis';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from '../chat/chat.service';
import { UsersService } from '../users/users.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { DrawClearDto } from './dto/draw-clear.dto';
import { DrawStrokeDto } from './dto/draw-stroke.dto';
import { JoinChatDto } from './dto/join-chat.dto';

@WebSocketGateway({
  namespace: '/drawback',
  cors: {
    origin: true,
    credentials: true,
  },
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class DrawGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(DrawGateway.name);
  private readonly userToSocket = new Map<string, string>();
  private readonly socketToUser = new Map<string, string>();
  /** tracks which room (if any) each socket has joined */
  private readonly socketToRoom = new Map<string, string>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const redisHost = this.config.get<string>('REDIS_HOST');

    if (!redisHost) {
      this.logger.log('REDIS_HOST not set — Redis adapter disabled');
      return;
    }

    const redisPort = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const redisPassword = this.config.get<string>('REDIS_PASSWORD');

    const redisOptions: RedisOptions = {
      host: redisHost,
      port: redisPort,
      ...(redisPassword ? { password: redisPassword } : {}),
    };

    const pubClient = new Redis(redisOptions);
    const subClient = pubClient.duplicate();

    this.server.adapter(createAdapter(pubClient, subClient));
    this.logger.log(
      `Socket.IO Redis adapter enabled (${redisHost}:${redisPort})`,
    );
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.extractUserIdFromToken(client);

    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }

    this.userToSocket.set(userId, client.id);
    this.socketToUser.set(client.id, userId);

    await this.usersService.setSocket(userId, client.id);
    this.logger.debug(`Socket connected: ${client.id} for user ${userId}`);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = this.socketToUser.get(client.id);

    if (!userId) {
      return;
    }

    // notify peer if this socket was inside a draw room
    const room = this.socketToRoom.get(client.id);
    if (room) {
      client.to(room).emit('draw.peer.left', { userId });
      this.socketToRoom.delete(client.id);
    }

    this.socketToUser.delete(client.id);

    const currentSocket = this.userToSocket.get(userId);
    if (currentSocket === client.id) {
      this.userToSocket.delete(userId);
    }

    await this.usersService.clearSocket(userId, client.id);
    this.logger.debug(`Socket disconnected: ${client.id} for user ${userId}`);
  }

  notifyChatRequested(userId: string, payload: Record<string, unknown>): void {
    void this.emitToUser(userId, 'chat.requested', payload);
  }

  notifyChatResponse(userId: string, payload: Record<string, unknown>): void {
    void this.emitToUser(userId, 'chat.response', payload);
  }

  @SubscribeMessage('chat.join')
  async joinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: JoinChatDto,
  ): Promise<void> {
    try {
      const userId = this.getAuthenticatedUserId(client);

      const roomId = await this.chatService.getAcceptedRoomForUser(
        dto.requestId,
        userId,
      );

      // leave any previous room first
      const prevRoom = this.socketToRoom.get(client.id);
      if (prevRoom && prevRoom !== roomId) {
        await client.leave(prevRoom);
        client.to(prevRoom).emit('draw.peer.left', { userId });
      }

      await client.join(roomId);
      this.socketToRoom.set(client.id, roomId);

      client.emit('chat.joined', { roomId, requestId: dto.requestId });

      // tell the other participant a peer has joined
      client.to(roomId).emit('draw.peer.joined', { userId });
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('draw.leave')
  async leaveChat(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = this.socketToUser.get(client.id);
    const room = this.socketToRoom.get(client.id);

    if (room) {
      client.to(room).emit('draw.peer.left', { userId });
      await client.leave(room);
      this.socketToRoom.delete(client.id);
    }

    client.emit('draw.left', {});
  }

  @SubscribeMessage('draw.stroke')
  async drawStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DrawStrokeDto,
  ): Promise<void> {
    try {
      const userId = this.getAuthenticatedUserId(client);

      const roomId = await this.chatService.getAcceptedRoomForUser(
        dto.requestId,
        userId,
      );

      client.to(roomId).emit('draw.stroke', dto);
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('draw.clear')
  async clearCanvas(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DrawClearDto,
  ): Promise<void> {
    try {
      const userId = this.getAuthenticatedUserId(client);

      const roomId = await this.chatService.getAcceptedRoomForUser(
        dto.requestId,
        userId,
      );

      client.to(roomId).emit('draw.clear', dto);
    } catch (err) {
      this.emitError(client, err);
    }
  }

  private async emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Prefer the in-memory map (fast path); fall back to the DB-persisted
    // socketId so notifications survive a server restart where the map is
    // cleared but connected clients retain their socket IDs.
    let socketId = this.userToSocket.get(userId);

    if (!socketId) {
      try {
        const user = await this.usersService.findById(userId);
        socketId = user.socketId ?? undefined;
      } catch {
        // user not found — nothing to emit
        return;
      }
    }

    if (!socketId) {
      this.logger.debug(
        `emitToUser: no socket found for user ${userId}, event '${event}' dropped`,
      );
      return;
    }

    this.server.to(socketId).emit(event, payload);
  }

  private extractUserIdFromToken(client: Socket): string | null {
    const auth = client.handshake.auth as Record<string, string | undefined>;
    const token: string | string[] | undefined =
      auth['token'] ??
      client.handshake.headers?.authorization?.replace('Bearer ', '') ??
      client.handshake.query?.['token'];

    if (!token || typeof token !== 'string') {
      return null;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      return payload.sub;
    } catch {
      return null;
    }
  }

  private getAuthenticatedUserId(client: Socket): string {
    const userId = this.socketToUser.get(client.id);
    if (!userId) {
      throw new UnauthorizedException('Socket not authenticated');
    }
    return userId;
  }

  private emitError(client: Socket, err: unknown): void {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred';
    const status = (err as { status?: number })?.status ?? 500;
    client.emit('error', { message, status });
    this.logger.warn(`Socket error [${client.id}]: ${message}`);
  }
}
