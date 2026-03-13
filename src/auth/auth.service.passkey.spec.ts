/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { UserRole } from '../users/enums/user-role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { Credential } from './entities/credential.entity';

// Mock @simplewebauthn/server
jest.mock('@simplewebauthn/server');

const mockGenerateRegistrationOptions =
  generateRegistrationOptions as jest.MockedFunction<
    typeof generateRegistrationOptions
  >;
const mockVerifyRegistrationResponse =
  verifyRegistrationResponse as jest.MockedFunction<
    typeof verifyRegistrationResponse
  >;
const mockGenerateAuthenticationOptions =
  generateAuthenticationOptions as jest.MockedFunction<
    typeof generateAuthenticationOptions
  >;
const mockVerifyAuthenticationResponse =
  verifyAuthenticationResponse as jest.MockedFunction<
    typeof verifyAuthenticationResponse
  >;

describe('AuthService - Passkey Tests', () => {
  let service: AuthService;
  let usersRepo: jest.Mocked<Repository<User>>;
  let credentialsRepo: jest.Mocked<Repository<Credential>>;
  let cacheService: jest.Mocked<CacheService>;

  const mockUser: Partial<User> = {
    id: 'user-123',
    email: 'test@example.com',
    displayName: 'testuser',
    isActivated: true,
    isBlocked: false,
    passwordHash: undefined,
    mode: UserMode.PRIVATE,
    role: UserRole.USER,
  };

  const mockCredential: Partial<Credential> = {
    id: 'cred-123',
    userId: 'user-123',
    credentialId: Buffer.from('credential-id-123'),
    publicKey: Buffer.from('public-key-123'),
    counter: 0,
    transports: ['internal'],
    lastUsedAt: new Date('2026-03-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-03-01'),
  };

  beforeEach(async () => {
    const mockUsersRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      manager: {
        transaction: jest.fn(),
      },
    };

    const mockCredentialsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      })),
      manager: {
        transaction: jest.fn((isolationLevelOrCallback, maybeCallback) => {
          // Handle both signatures: transaction(callback) and transaction(isolationLevel, callback)
          const callback =
            typeof isolationLevelOrCallback === 'function'
              ? isolationLevelOrCallback
              : maybeCallback;

          // Execute transaction callback with a mock transactional entity manager
          const mockTransactionalEM = {
            create: jest.fn((entity, data) => ({ ...data, id: 'new-cred-id' })),
            save: jest.fn((entity) => Promise.resolve(entity)),
            find: jest.fn(() => Promise.resolve([mockCredential])),
            remove: jest.fn(() => Promise.resolve([])),
            createQueryBuilder: jest.fn(() => ({
              delete: jest.fn().mockReturnThis(),
              from: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({ affected: 0 }),
            })),
          };
          return callback(mockTransactionalEM);
        }),
      },
    };

    const mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          WEBAUTHN_RP_ID: 'localhost',
          WEBAUTHN_RP_NAME: 'Test App',
          WEBAUTHN_ORIGIN: 'http://localhost:3001',
        };
        return config[key];
      }),
    };

    const mockJwtService = {
      sign: jest.fn(() => 'mock-jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUsersRepo },
        {
          provide: getRepositoryToken(Credential),
          useValue: mockCredentialsRepo,
        },
        { provide: CacheService, useValue: mockCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: MailService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersRepo = module.get(getRepositoryToken(User));
    credentialsRepo = module.get(getRepositoryToken(Credential));
    cacheService = module.get(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startPasskeyRegistration', () => {
    it('should generate registration options and store challenge in Redis', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      mockGenerateRegistrationOptions.mockResolvedValue({
        challenge: 'test-challenge-123',
        rp: { name: 'Test App', id: 'localhost' },
      } as any);

      const result = await service.startPasskeyRegistration('user-123');

      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'user-123' },
      });
      expect(mockGenerateRegistrationOptions).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalledWith(
        'challenge:user-123',
        'test-challenge-123',
        300, // 5 minutes TTL
      );
      expect(result.challenge).toBe('test-challenge-123');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.startPasskeyRegistration('nonexistent'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user not activated', async () => {
      usersRepo.findOne.mockResolvedValue({
        ...mockUser,
        isActivated: false,
      } as User);

      await expect(
        service.startPasskeyRegistration('user-123'),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Account must be activated before registering passkeys',
        ),
      );
    });

    it('should throw ForbiddenException if user is blocked', async () => {
      usersRepo.findOne.mockResolvedValue({
        ...mockUser,
        isBlocked: true,
      } as User);

      await expect(
        service.startPasskeyRegistration('user-123'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('finishPasskeyRegistration', () => {
    const mockRegistrationData = {
      data: {
        id: 'new-credential-id',
        rawId: 'new-credential-id',
        response: { clientDataJSON: 'data', attestationObject: 'obj' },
        type: 'public-key',
      } as any,
    };

    beforeEach(() => {
      mockVerifyRegistrationResponse.mockResolvedValue({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-credential-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
        },
      } as any);
    });

    it('should verify registration and save credential with lastUsedAt set', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      cacheService.get.mockResolvedValue('expected-challenge');
      credentialsRepo.findOne.mockResolvedValue(null); // No existing credential

      const result = await service.finishPasskeyRegistration(
        'user-123',
        mockRegistrationData,
      );

      expect(usersRepo.findOne).toHaveBeenCalled();
      expect(cacheService.get).toHaveBeenCalledWith('challenge:user-123');
      expect(mockVerifyRegistrationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedChallenge: 'expected-challenge',
        }),
      );
      expect(cacheService.del).toHaveBeenCalledWith('challenge:user-123');
      expect(credentialsRepo.manager.transaction).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException if challenge not found', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      cacheService.get.mockResolvedValue(null); // No challenge in Redis

      await expect(
        service.finishPasskeyRegistration('user-123', mockRegistrationData),
      ).rejects.toThrow(
        new BadRequestException(
          'No challenge found or challenge expired. Please try again.',
        ),
      );
    });

    it('should delete challenge on verification failure', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      cacheService.get.mockResolvedValue('expected-challenge');
      mockVerifyRegistrationResponse.mockRejectedValue(
        new Error('Verification failed'),
      );

      await expect(
        service.finishPasskeyRegistration('user-123', mockRegistrationData),
      ).rejects.toThrow(BadRequestException);

      expect(cacheService.del).toHaveBeenCalledWith('challenge:user-123');
    });
  });

  describe('startPasskeyLogin', () => {
    it('should generate authentication options and store challenge', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      credentialsRepo.find.mockResolvedValue([mockCredential as Credential]);
      mockGenerateAuthenticationOptions.mockResolvedValue({
        challenge: 'auth-challenge-123',
        rpId: 'localhost',
      } as any);

      const result = await service.startPasskeyLogin({
        email: 'test@example.com',
      });

      expect(usersRepo.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(credentialsRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(cacheService.set).toHaveBeenCalledWith(
        'challenge:user-123',
        'auth-challenge-123',
        300,
      );
      expect(result.challenge).toBe('auth-challenge-123');
    });

    it('should use constant-time response for user enumeration prevention', async () => {
      usersRepo.findOne.mockResolvedValue(null); // User doesn't exist
      credentialsRepo.find.mockResolvedValue([]);

      const startTime = Date.now();
      await expect(
        service.startPasskeyLogin({ email: 'nonexistent@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      const duration = Date.now() - startTime;

      // Should take at least 100ms (artificial delay)
      expect(duration).toBeGreaterThanOrEqual(90);
    });

    it('should throw generic error if user has no passkeys', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser as User);
      credentialsRepo.find.mockResolvedValue([]); // No credentials

      await expect(
        service.startPasskeyLogin({ email: 'test@example.com' }),
      ).rejects.toThrow(
        new UnauthorizedException(
          'Invalid credentials or no passkeys registered for this account.',
        ),
      );
    });

    it('should throw generic error if user is not activated', async () => {
      usersRepo.findOne.mockResolvedValue({
        ...mockUser,
        isActivated: false,
      } as User);
      credentialsRepo.find.mockResolvedValue([mockCredential as Credential]);

      await expect(
        service.startPasskeyLogin({ email: 'test@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('finishPasskeyLogin - Counter Rollback Protection', () => {
    const mockAuthData = {
      data: {
        id: 'credential-id-123',
        rawId: 'credential-id-123',
        response: {
          authenticatorData: 'data',
          clientDataJSON: 'json',
          signature: 'sig',
          userHandle: 'handle',
        },
        type: 'public-key',
      } as any,
    };

    beforeEach(() => {
      credentialsRepo.findOne.mockResolvedValue({
        ...mockCredential,
        user: mockUser,
      } as any);
      cacheService.get.mockResolvedValue('expected-challenge');
    });

    it('should reject authentication if counter did not increase', async () => {
      // Credential has counter = 5
      credentialsRepo.findOne.mockResolvedValue({
        ...mockCredential,
        counter: 5,
        user: mockUser,
      } as any);

      // Verification returns counter = 3 (rollback!)
      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 3,
        },
      } as any);

      await expect(service.finishPasskeyLogin(mockAuthData)).rejects.toThrow(
        new UnauthorizedException(
          'Authentication failed. Please contact support.',
        ),
      );

      expect(credentialsRepo.save).not.toHaveBeenCalled();
    });

    it('should accept authentication if counter increased', async () => {
      credentialsRepo.findOne.mockResolvedValue({
        ...mockCredential,
        counter: 5,
        user: mockUser,
      } as any);

      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 6, // Counter increased
        },
      } as any);

      const result = await service.finishPasskeyLogin(mockAuthData);

      expect(credentialsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          counter: 6,
        }),
      );
      expect(result.accessToken).toBeDefined();
    });

    it('should accept if both counters are 0 (non-incrementing authenticator)', async () => {
      credentialsRepo.findOne.mockResolvedValue({
        ...mockCredential,
        counter: 0,
        user: mockUser,
      } as any);

      mockVerifyAuthenticationResponse.mockResolvedValue({
        verified: true,
        authenticationInfo: {
          newCounter: 0,
        },
      } as any);

      const result = await service.finishPasskeyLogin(mockAuthData);

      expect(result.accessToken).toBeDefined();
    });
  });

  describe('listCredentials', () => {
    it('should return sanitized credential list', async () => {
      const credentials = [
        mockCredential,
        { ...mockCredential, id: 'cred-456', lastUsedAt: null },
      ];
      credentialsRepo.find.mockResolvedValue(credentials as Credential[]);

      const result = await service.listCredentials('user-123');

      expect(credentialsRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'cred-123',
        createdAt: mockCredential.createdAt,
        lastUsedAt: mockCredential.lastUsedAt,
        transports: ['internal'],
      });
      expect(result[0]).not.toHaveProperty('credentialId');
      expect(result[0]).not.toHaveProperty('publicKey');
      expect(result[0]).not.toHaveProperty('counter');
    });
  });

  describe('deleteCredential', () => {
    it('should delete credential if not the last one', async () => {
      credentialsRepo.findOne.mockResolvedValue(mockCredential as Credential);
      credentialsRepo.count.mockResolvedValue(2); // User has 2 credentials
      usersRepo.findOne.mockResolvedValue(mockUser as User);

      await service.deleteCredential('user-123', 'cred-123');

      expect(credentialsRepo.remove).toHaveBeenCalledWith(mockCredential);
    });

    it('should throw if credential not found', async () => {
      credentialsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteCredential('user-123', 'nonexistent'),
      ).rejects.toThrow(new BadRequestException('Passkey not found'));
    });

    it('should prevent deletion of last passkey without password', async () => {
      credentialsRepo.findOne.mockResolvedValue(mockCredential as Credential);
      credentialsRepo.count.mockResolvedValue(1); // Only 1 credential
      usersRepo.findOne.mockResolvedValue({
        ...mockUser,
        passwordHash: null, // No password set
      } as unknown as User);

      await expect(
        service.deleteCredential('user-123', 'cred-123'),
      ).rejects.toThrow(
        new BadRequestException(
          'Cannot delete last passkey. Set a password first to avoid account lockout.',
        ),
      );

      expect(credentialsRepo.remove).not.toHaveBeenCalled();
    });

    it('should allow deletion of last passkey if password is set', async () => {
      credentialsRepo.findOne.mockResolvedValue(mockCredential as Credential);
      credentialsRepo.count.mockResolvedValue(1);
      usersRepo.findOne.mockResolvedValue({
        ...mockUser,
        passwordHash: '$2b$12$hashedpassword', // Password is set
      } as User);

      await service.deleteCredential('user-123', 'cred-123');

      expect(credentialsRepo.remove).toHaveBeenCalled();
    });
  });
});
