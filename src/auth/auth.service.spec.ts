import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { AuthService } from './auth.service';

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
};
type MockedJwtService = { sign: jest.Mock };
type MockedMailService = { sendActivationEmail: jest.Mock };

const repositoryMockFactory = (): MockedUsersRepo => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let usersRepo: MockedUsersRepo;
  let jwtService: MockedJwtService;
  let mailService: MockedMailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(User),
          useFactory: repositoryMockFactory,
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('jwt-token') },
        },
        {
          provide: MailService,
          useValue: {
            sendActivationEmail: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    usersRepo = module.get<MockedUsersRepo>(getRepositoryToken(User));
    jwtService = module.get<MockedJwtService>(JwtService);
    mailService = module.get<MockedMailService>(MailService);
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
      expect(result.message).toMatch(/activated/i);
    });

    it('throws BadRequestException for invalid token', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.confirmEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── login ─────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto = { email: 'alice@example.com', password: 'Password1!' };

    it('returns accessToken for valid credentials', async () => {
      const user = mockUser() as User;
      usersRepo.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto);

      expect(result.accessToken).toBe('jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: user.id, email: user.email }),
      );
    });

    it('throws UnauthorizedException when user not found', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser() as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when account not activated', async () => {
      usersRepo.findOne.mockResolvedValue({
        ...mockUser(),
        isActivated: false,
      } as User);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
    });
  });
});
