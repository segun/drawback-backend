import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CacheService } from '../cache/cache.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { Credential } from './entities/credential.entity';

// Mock bcrypt at module level so its exports are configurable
jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$hashed'),
  compare: jest.fn(),
}));

import * as bcrypt from 'bcrypt';

const mockUser = (): Partial<User> => ({
  id: 'user-1',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hashedpassword',
  displayName: '@alice',
  isActivated: true,
  activationToken: null,
  mode: UserMode.PRIVATE,
});

type MockedUsersRepo = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
  find: jest.Mock;
};
type MockedJwtService = { sign: jest.Mock };
type MockedMailService = { sendActivationEmail: jest.Mock };
type MockedUsersService = { isDisplayNameAvailable: jest.Mock };

const repositoryMockFactory = (): MockedUsersRepo => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  find: jest.fn().mockResolvedValue([]),
});

describe('AuthService', () => {
  let service: AuthService;
  let usersRepo: MockedUsersRepo;
  let credentialsRepo: MockedUsersRepo;
  let jwtService: MockedJwtService;
  let mailService: MockedMailService;
  let usersService: MockedUsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useFactory: repositoryMockFactory,
        },
        {
          provide: getRepositoryToken(Credential),
          useFactory: repositoryMockFactory,
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: CacheService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendActivationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3001'),
          },
        },
        {
          provide: UsersService,
          useValue: {
            isDisplayNameAvailable: jest.fn().mockResolvedValue(true),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    usersRepo = module.get<MockedUsersRepo>(getRepositoryToken(User));
    credentialsRepo = module.get<MockedUsersRepo>(getRepositoryToken(Credential));
    jwtService = module.get<MockedJwtService>(JwtService);
    mailService = module.get<MockedMailService>(MailService);
    usersService = module.get<MockedUsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── register ─────────────────────────────────────────────────────────

  describe('register', () => {
    const dto = {
      email: 'Alice@Example.com',
      password: 'Password1!',
      displayName: '@Alice',
    };

    it('creates user and sends activation email', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      usersRepo.create.mockReturnValue(mockUser() as User);
      usersRepo.save.mockResolvedValue(mockUser() as User);

      const result = await service.register(dto);

      expect(usersRepo.findOne).toHaveBeenCalledTimes(2);
      expect(usersRepo.save).toHaveBeenCalledTimes(1);
      expect(mailService.sendActivationEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
        expect.any(String),
      );
      expect(result.message).toMatch(/check your email/i);
    });

    it('throws ConflictException when email is taken', async () => {
      usersRepo.findOne.mockResolvedValueOnce(mockUser() as User);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when display name is taken', async () => {
      usersRepo.findOne
        .mockResolvedValueOnce(null) // email check
        .mockResolvedValueOnce(mockUser() as User); // name check

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ── confirmEmail ─────────────────────────────────────────────────────

  describe('confirmEmail', () => {
    it('activates account and clears token', async () => {
      const user = {
        ...mockUser(),
        isActivated: false,
        activationToken: 'tok-1',
      } as User;
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({
        ...user,
        isActivated: true,
        activationToken: null,
      } as User);

      const result = await service.confirmEmail('tok-1');

      expect(user.isActivated).toBe(true);
      expect(user.activationToken).toBeNull();
      expect(result.success).toBe(true);
      expect(result.email).toBe('alice@example.com');
    });

    it('returns failure response for invalid token', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      const result = await service.confirmEmail('bad-token');

      expect(result.success).toBe(false);
      expect(result.email).toBeNull();
      expect(result.reason).toMatch(/invalid or expired/i);
    });
  });

  // ── login ─────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { email: 'alice@example.com', password: 'Password1!' };

    it('returns accessToken for valid credentials', async () => {
      const user = mockUser() as User;
      usersRepo.findOne.mockResolvedValue(user);
      credentialsRepo.find.mockResolvedValue([]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.accessToken).toBe('jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, email: user.email }),
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.login(dto)).resolves.toBeNull();
    });

    it('throws UnauthorizedException on wrong password', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser() as User);
      credentialsRepo.find.mockResolvedValue([]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).resolves.toBeNull();
    });

    it('throws UnauthorizedException when account not activated', async () => {
      usersRepo.findOne.mockResolvedValue({
        ...mockUser(),
        isActivated: false,
      } as User);
      credentialsRepo.find.mockResolvedValue([]);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });
  });
});
