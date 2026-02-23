import {
  ForbiddenException,
  Inject,
  Logger,
  OnModuleDestroy,
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

/** Max draw.stroke events allowed per socket per second. */
const STROKE_RATE_LIMIT = 60;
/** Max draw.clear events allowed per socket per 5 seconds. */
const CLEAR_RATE_LIMIT = 5;
const CLEAR_RATE_WINDOW_MS = 5_000;

/** Redis key prefix for the user→socketId mapping shared across all workers. */
const USER_SOCKET_KEY = 'drawback:user-socket';

@WebSocketGateway({
  namespace: '/drawback',
  cors: {
    origin: true,
    credentials: true,
  },
})
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class DrawGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(DrawGateway.name);

  /**
   * Local cache of socketId → userId for the sockets connected to *this*
   * process. Used only for cheap O(1) lookups on the hot path — not relied on
   * for cross-process emission (Redis handles that).
   */
  private readonly socketToUser = new Map<string, string>();

  /** tracks which room (if any) each socket has joined */
  private readonly socketToRoom = new Map<string, string>();

  /**
   * Per-socket stroke rate limiting: socketId → { count, windowStart }.
   * Resets every second.
   */
  private readonly strokeRateMap = new Map<
    string,
    { count: number; windowStart: number }
  >();

  /**
   * Per-socket clear rate limiting: socketId → { count, windowStart }.
   * Resets every CLEAR_RATE_WINDOW_MS.
   */
  private readonly clearRateMap = new Map<
    string,
    { count: number; windowStart: number }
  >();

  @WebSocketServer()
  server!: Server;

  /**
   * Shared Redis client used for the user→socket hash and (when configured)
   * as the pub/sub pub client. Kept as an instance property so it can be
   * reused by emitToUser without creating extra connections.
   */
  private redisClient: Redis | null = null;

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
      this.logger.warn(
        'REDIS_HOST not set — Redis adapter disabled. ' +
          'Running without Redis is only suitable for single-process development.',
      );
      return;
    }

    const redisPort = Number(this.config.get<string>('REDIS_PORT') ?? 6379);
    const redisPassword = this.config.get<string>('REDIS_PASSWORD');

    const redisOptions: RedisOptions = {
      host: redisHost,
      port: redisPort,
      ...(redisPassword ? { password: redisPassword } : {}),
      // Reconnect aggressively so a blip doesn't permanently break the adapter.
      retryStrategy: (times) => Math.min(times * 100, 3_000),
    };

    this.redisClient = new Redis(redisOptions);
    const subClient = this.redisClient.duplicate();

    this.server.adapter(createAdapter(this.redisClient, subClient));
    this.logger.log(
      `Socket.IO Redis adapter enabled (${redisHost}:${redisPort})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = this.extractUserIdFromToken(client);

    if (!userId) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }

    this.socketToUser.set(client.id, userId);

    // Persist user→socket in Redis (shared across all processes/workers).
    if (this.redisClient) {
      await this.redisClient.hset(USER_SOCKET_KEY, userId, client.id);
    }

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
    this.strokeRateMap.delete(client.id);
    this.clearRateMap.delete(client.id);

    // Remove from Redis only if this socket is still the current one for the
    // user (guards against a reconnect on another worker overwriting then being
    // incorrectly cleared here).
    if (this.redisClient) {
      const current = await this.redisClient.hget(USER_SOCKET_KEY, userId);
      if (current === client.id) {
        await this.redisClient.hdel(USER_SOCKET_KEY, userId);
      }
    }

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

      // Collect user IDs of peers already in the room so the joining client
      // receives presence info immediately, without waiting for a separate
      // draw.peer.joined event (which only fires for the peers, not the joiner).
      const roomSockets = await this.server.in(roomId).allSockets();
      const peers: string[] = [];
      for (const socketId of roomSockets) {
        if (socketId === client.id) continue;
        const peerId = this.socketToUser.get(socketId);
        if (peerId) peers.push(peerId);
      }

      client.emit('chat.joined', { roomId, requestId: dto.requestId, peers });

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
  drawStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DrawStrokeDto,
  ): void {
    // Rate limit: max STROKE_RATE_LIMIT strokes per second per socket.
    if (this.isStrokeRateLimited(client.id)) {
      return; // silently drop — don't disconnect, just shed the load
    }

    // Use the cached room — validated once during chat.join.
    // No DB query needed on the hot drawing path.
    const room = this.socketToRoom.get(client.id);
    if (!room) {
      this.emitError(client, new ForbiddenException('Not in a room'));
      return;
    }

    client.to(room).emit('draw.stroke', dto);
  }

  @SubscribeMessage('draw.clear')
  clearCanvas(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: DrawClearDto,
  ): void {
    // Rate limit: max CLEAR_RATE_LIMIT clears per CLEAR_RATE_WINDOW_MS per socket.
    if (this.isClearRateLimited(client.id)) {
      this.emitError(
        client,
        new ForbiddenException(
          `Too many clear events. Max ${CLEAR_RATE_LIMIT} per ${CLEAR_RATE_WINDOW_MS / 1000}s.`,
        ),
      );
      return;
    }

    const room = this.socketToRoom.get(client.id);
    if (!room) {
      this.emitError(client, new ForbiddenException('Not in a room'));
      return;
    }

    client.to(room).emit('draw.clear', dto);
  }

  /**
   * Emit an event to a specific user. Looks up the socket ID from Redis
   * (shared across all workers) so this works correctly in a multi-process
   * deployment. Falls back to the DB-persisted socketId only when Redis is
   * not configured.
   */
  private async emitToUser(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    let socketId: string | null | undefined;

    if (this.redisClient) {
      socketId = await this.redisClient.hget(USER_SOCKET_KEY, userId);
    } else {
      // No Redis — fall back to DB-persisted socketId (single-process only).
      try {
        const user = await this.usersService.findById(userId);
        socketId = user.socketId ?? undefined;
      } catch {
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

  // ---------------------------------------------------------------------------
  // Rate limiting helpers
  // ---------------------------------------------------------------------------

  private isStrokeRateLimited(socketId: string): boolean {
    const now = Date.now();
    const entry = this.strokeRateMap.get(socketId) ?? {
      count: 0,
      windowStart: now,
    };

    if (now - entry.windowStart >= 1_000) {
      // New 1-second window
      entry.count = 1;
      entry.windowStart = now;
      this.strokeRateMap.set(socketId, entry);
      return false;
    }

    entry.count++;
    this.strokeRateMap.set(socketId, entry);
    return entry.count > STROKE_RATE_LIMIT;
  }

  private isClearRateLimited(socketId: string): boolean {
    const now = Date.now();
    const entry = this.clearRateMap.get(socketId) ?? {
      count: 0,
      windowStart: now,
    };

    if (now - entry.windowStart >= CLEAR_RATE_WINDOW_MS) {
      entry.count = 1;
      entry.windowStart = now;
      this.clearRateMap.set(socketId, entry);
      return false;
    }

    entry.count++;
    this.clearRateMap.set(socketId, entry);
    return entry.count > CLEAR_RATE_LIMIT;
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

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
