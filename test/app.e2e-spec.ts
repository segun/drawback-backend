import {
  ClassSerializerInterceptor,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from './../src/app.controller';
import { AppService } from './../src/app.service';
import { AuthModule } from './../src/auth/auth.module';
import { ChatRequest } from './../src/chat/entities/chat-request.entity';
import { ChatRequestStatus } from './../src/chat/enums/chat-request-status.enum';
import { ChatModule } from './../src/chat/chat.module';
import { MailService } from './../src/mail/mail.service';
import { UserBlock } from './../src/users/entities/user-block.entity';
import { User } from './../src/users/entities/user.entity';
import { UserMode } from './../src/users/enums/user-mode.enum';
import { UsersModule } from './../src/users/users.module';
import { SavedChat } from './../src/chat/entities/saved-chat.entity';
import { ThrottlerModule } from '@nestjs/throttler';
import { DrawGateway } from './../src/realtime/draw.gateway';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
  compare: jest.fn().mockResolvedValue(true),
}));

// ─── In-memory users (real class instances so @Exclude works) ────────────────

const alice = Object.assign(new User(), {
  id: 'alice-id',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hashed',
  displayName: '@alice',
  isActivated: true,
  activationToken: 'should-be-excluded',
  mode: UserMode.PUBLIC,
  socketId: 'sock-1',
});

const bob = Object.assign(new User(), {
  id: 'bob-id',
  email: 'bob@example.com',
  passwordHash: '$2b$12$hashed',
  displayName: '@bob',
  isActivated: true,
  activationToken: null,
  mode: UserMode.PUBLIC,
  socketId: null,
});

const pendingRequest: Partial<ChatRequest> = {
  id: 'req-1',
  fromUserId: alice.id,
  toUserId: bob.id,
  status: ChatRequestStatus.PENDING,
  fromUser: alice as User,
  toUser: bob as User,
};

// ─── Repo mocks ───────────────────────────────────────────────────────────────

const qbMock = (count = 0, many: object[] = []) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue(many),
  getCount: jest.fn().mockResolvedValue(count),
});

const usersRepo = {
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([alice, bob]),
  create: jest.fn().mockImplementation((d: Record<string, unknown>) => ({
    ...d,
    id: 'new-user',
    isActivated: false as const,
  })),
  save: jest.fn().mockImplementation((e: Record<string, unknown>) =>
    Promise.resolve({
      ...e,
      id: (e['id'] as string | undefined) ?? 'new-user',
    }),
  ),
  remove: jest.fn().mockResolvedValue({}),
  update: jest.fn().mockResolvedValue({}),
  createQueryBuilder: jest.fn(() => qbMock(0, [bob])),
};

const blocksRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((d: Record<string, unknown>) => d),
  save: jest.fn().mockResolvedValue({}),
  delete: jest.fn().mockResolvedValue({}),
  createQueryBuilder: jest.fn(() => qbMock(0)),
};

const chatRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((d: Record<string, unknown>) => ({
    ...d,
    id: 'req-new',
  })),
  save: jest.fn().mockImplementation((e: Record<string, unknown>) =>
    Promise.resolve({
      ...e,
      id: (e['id'] as string | undefined) ?? 'req-new',
    }),
  ),
  remove: jest.fn().mockResolvedValue({}),
};

const savedChatsRepo = {
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((d: Record<string, unknown>) => ({
    ...d,
    id: 'saved-new',
  })),
  save: jest.fn().mockImplementation((e: Record<string, unknown>) =>
    Promise.resolve({
      ...e,
      id: (e['id'] as string | undefined) ?? 'saved-new',
    }),
  ),
  remove: jest.fn().mockResolvedValue({}),
};

/** Gateway mock – prevents Socket.IO from starting */
const gatewayMock = {
  notifyChatRequested: jest.fn(),
  notifyChatResponse: jest.fn(),
  userToSocket: new Map(),
  socketToUser: new Map(),
  socketToRoom: new Map(),
};

// ─── Minimal test module (no real DB, no real Socket.IO) ─────────────────────

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'auth', ttl: 60000, limit: 100 }]),
    AuthModule,
    UsersModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
class TestAppModule {}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('Drawback API (e2e)', () => {
  let app: INestApplication<App>;
  let aliceToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TestAppModule],
    })
      .overrideProvider(getRepositoryToken(User))
      .useValue(usersRepo)
      .overrideProvider(getRepositoryToken(UserBlock))
      .useValue(blocksRepo)
      .overrideProvider(getRepositoryToken(ChatRequest))
      .useValue(chatRepo)
      .overrideProvider(getRepositoryToken(SavedChat))
      .useValue(savedChatsRepo)
      .overrideProvider(MailService)
      .useValue({ sendActivationEmail: jest.fn().mockResolvedValue(undefined) })
      .overrideProvider(DrawGateway)
      .useValue(gatewayMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();
  }, 15000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  // ── Health ──────────────────────────────────────────────────────────

  it('GET / → health check', () =>
    request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ name: 'DrawkcaB backend', status: 'ok' }));

  // ── Auth ────────────────────────────────────────────────────────────

  describe('Auth', () => {
    it('POST /auth/login → returns JWT for alice', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@example.com', password: 'Password1!' })
        .expect(201);

      const loginBody = res.body as { accessToken: string };
      expect(loginBody.accessToken).toBeDefined();
      aliceToken = loginBody.accessToken;
    });

    it('POST /auth/login → 401 on wrong password', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@example.com', password: 'WrongPass!' })
        .expect(401);
    });

    it('POST /auth/register → 400 when body is invalid', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email' })
        .expect(400);
    });

    it('POST /auth/register → 201 with valid payload', async () => {
      usersRepo.findOne.mockResolvedValue(null); // no conflicts

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'newuser@example.com',
          password: 'Password1!',
          displayName: '@newuser',
        })
        .expect(201);

      expect((res.body as { message: string }).message).toMatch(
        /check your email/i,
      );
    });
  });

  // ── Users ───────────────────────────────────────────────────────────

  describe('Users (authenticated)', () => {
    beforeEach(async () => {
      if (!aliceToken) {
        usersRepo.findOne.mockResolvedValueOnce(alice);
        (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'alice@example.com', password: 'Password1!' });
        aliceToken = (res.body as { accessToken: string }).accessToken;
      }
    });

    it('GET /users/me → returns profile without sensitive fields', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice); // jwt strategy

      const res = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      const meBody = res.body as {
        email: string;
        passwordHash?: string;
        activationToken?: string;
      };
      expect(meBody.email).toBe('alice@example.com');
      expect(meBody.passwordHash).toBeUndefined();
      expect(meBody.activationToken).toBeUndefined();
    });

    it('GET /users/me → 401 without token', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('GET /users/public → returns list of public users', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      usersRepo.createQueryBuilder.mockReturnValueOnce(qbMock(0, [bob]));

      const res = await request(app.getHttpServer())
        .get('/users/public')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /users/search?q=bob → returns matching users', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      usersRepo.createQueryBuilder.mockReturnValueOnce(qbMock(0, [bob]));

      const res = await request(app.getHttpServer())
        .get('/users/search?q=bob')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── Chat Requests ────────────────────────────────────────────────────

  describe('Chat Requests (authenticated)', () => {
    beforeEach(async () => {
      if (!aliceToken) {
        usersRepo.findOne.mockResolvedValueOnce(alice);
        (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
        const res = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'alice@example.com', password: 'Password1!' });
        aliceToken = (res.body as { accessToken: string }).accessToken;
      }
    });

    it('POST /chat/requests → creates request to @bob', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice); // jwt strategy
      usersRepo.findOne.mockResolvedValueOnce(alice); // findById (fromUser)
      usersRepo.findOne.mockResolvedValueOnce(bob); // findByDisplayName (toUser)
      blocksRepo.createQueryBuilder.mockReturnValueOnce(qbMock(0));
      chatRepo.findOne.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .post('/chat/requests')
        .set('Authorization', `Bearer ${aliceToken}`)
        .send({ toDisplayName: '@bob' })
        .expect(201);

      expect((res.body as { id: string }).id).toBeDefined();
    });

    it('GET /chat/requests/sent → returns sent requests list', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      chatRepo.find.mockResolvedValueOnce([pendingRequest]);

      const res = await request(app.getHttpServer())
        .get('/chat/requests/sent')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /chat/requests/received → returns received requests list', async () => {
      usersRepo.findOne.mockResolvedValueOnce(alice);
      chatRepo.find.mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .get('/chat/requests/received')
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
