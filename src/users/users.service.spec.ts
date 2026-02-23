import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserBlock } from './entities/user-block.entity';
import { User } from './entities/user.entity';
import { UserMode } from './enums/user-mode.enum';
import { UsersService } from './users.service';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'alice@example.com',
    displayName: '@alice',
    mode: UserMode.PRIVATE,
    ...overrides,
  }) as User;

const qbMock = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
});

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: ReturnType<typeof repoMock>;
  let blocksRepo: ReturnType<typeof repoMock>;

  beforeEach(async () => {
    usersRepo = repoMock();
    blocksRepo = repoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(UserBlock), useValue: blocksRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findById ────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns user when found', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toEqual(user);
    });

    it('throws NotFoundException when not found', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateDisplayName ────────────────────────────────────────────────

  describe('updateDisplayName', () => {
    it('updates display name successfully', async () => {
      const user = makeUser();
      usersRepo.findOne
        .mockResolvedValueOnce(user) // findById
        .mockResolvedValueOnce(null); // conflict check
      usersRepo.save.mockResolvedValue({
        ...user,
        displayName: '@bob',
      } as User);

      const result = await service.updateDisplayName('user-1', {
        displayName: '@bob',
      });

      expect(result.displayName).toBe('@bob');
    });

    it('throws ConflictException when display name taken by someone else', async () => {
      const user = makeUser();
      const otherUser = makeUser({ id: 'user-2', displayName: '@bob' });
      usersRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(otherUser);

      await expect(
        service.updateDisplayName('user-1', { displayName: '@bob' }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows updating to own name (no conflict)', async () => {
      const user = makeUser({ displayName: '@alice' });
      usersRepo.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(user); // same user
      usersRepo.save.mockResolvedValue(user);

      await expect(
        service.updateDisplayName('user-1', { displayName: '@alice' }),
      ).resolves.toEqual(user);
    });
  });

  // ── setMode ──────────────────────────────────────────────────────────

  describe('setMode', () => {
    it('sets user mode to PUBLIC', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({
        ...user,
        mode: UserMode.PUBLIC,
      } as User);

      const result = await service.setMode('user-1', UserMode.PUBLIC);

      expect(result.mode).toBe(UserMode.PUBLIC);
    });
  });

  // ── deleteAccount ────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    it('removes user from repository', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.remove.mockResolvedValue(user);

      await service.deleteAccount('user-1');

      expect(usersRepo.remove).toHaveBeenCalledWith(user);
    });
  });

  // ── blockUser ────────────────────────────────────────────────────────

  describe('blockUser', () => {
    it('throws BadRequestException when blocking self', async () => {
      await expect(service.blockUser('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates block record', async () => {
      const target = makeUser({ id: 'user-2' });
      usersRepo.findOne.mockResolvedValue(target);
      blocksRepo.findOne.mockResolvedValue(null);
      blocksRepo.create.mockReturnValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });
      blocksRepo.save.mockResolvedValue({});

      await service.blockUser('user-1', 'user-2');

      expect(blocksRepo.save).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when block already exists', async () => {
      const target = makeUser({ id: 'user-2' });
      usersRepo.findOne.mockResolvedValue(target);
      blocksRepo.findOne.mockResolvedValue({
        blockerId: 'user-1',
        blockedId: 'user-2',
      });

      await service.blockUser('user-1', 'user-2');

      expect(blocksRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── isBlocked ────────────────────────────────────────────────────────

  describe('isBlocked', () => {
    it('returns true when block exists in either direction', async () => {
      const qb = qbMock();
      qb.getCount.mockResolvedValue(1);
      blocksRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.isBlocked('user-1', 'user-2')).resolves.toBe(true);
    });

    it('returns false when no block exists', async () => {
      const qb = qbMock();
      qb.getCount.mockResolvedValue(0);
      blocksRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.isBlocked('user-1', 'user-2')).resolves.toBe(false);
    });
  });
});
