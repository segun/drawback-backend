import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CacheService } from '../cache/cache.service';
import { ChatRequestStatus } from '../chat/enums/chat-request-status.enum';
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
    appearInSearches: true,
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

const cacheMock = (): jest.Mocked<
  Pick<CacheService, 'get' | 'getInstance' | 'set' | 'del' | 'delByPattern'>
> => ({
  get: jest.fn().mockResolvedValue(null),
  getInstance: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  delByPattern: jest.fn().mockResolvedValue(undefined),
});

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: ReturnType<typeof repoMock>;
  let blocksRepo: ReturnType<typeof repoMock>;
  let cache: ReturnType<typeof cacheMock>;

  beforeEach(async () => {
    usersRepo = repoMock();
    blocksRepo = repoMock();
    cache = cacheMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(UserBlock), useValue: blocksRepo },
        { provide: CacheService, useValue: cache },
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

  // ── setAppearInSearches ──────────────────────────────────────────────

  describe('setAppearInSearches', () => {
    it('sets appearInSearches to false and saves', async () => {
      const user = makeUser({ appearInSearches: true });
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({ ...user, appearInSearches: false });

      const result = await service.setAppearInSearches('user-1', false);

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ appearInSearches: false }),
      );
      expect(result.appearInSearches).toBe(false);
    });

    it('sets appearInSearches to true and saves', async () => {
      const user = makeUser({ appearInSearches: false });
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue({ ...user, appearInSearches: true });

      const result = await service.setAppearInSearches('user-1', true);

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ appearInSearches: true }),
      );
      expect(result.appearInSearches).toBe(true);
    });

    it('invalidates the user cache entry', async () => {
      const user = makeUser();
      usersRepo.findOne.mockResolvedValue(user);
      usersRepo.save.mockResolvedValue(user);

      await service.setAppearInSearches('user-1', false);

      expect(cache.del).toHaveBeenCalledWith('user:user-1');
    });

    it('throws NotFoundException when user does not exist', async () => {
      usersRepo.findOne.mockResolvedValue(null);

      await expect(
        service.setAppearInSearches('missing', false),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── searchByDisplayName ──────────────────────────────────────────────

  describe('searchByDisplayName', () => {
    it('returns results from the query builder', async () => {
      const publicUser = makeUser({
        id: 'user-2',
        mode: UserMode.PUBLIC,
      });
      const qb = qbMock();
      qb.getMany.mockResolvedValue([publicUser]);
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchByDisplayName('alice', 'user-1');

      expect(result).toEqual([publicUser]);
      expect(qb.getMany).toHaveBeenCalled();
    });

    it('returns empty array when query builder finds nothing', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.searchByDisplayName('unknown', 'user-1');

      expect(result).toEqual([]);
    });

    it('applies an appearInSearches condition in the visibility clause', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      await service.searchByDisplayName('alice', 'user-1');

      const allWhereSqls: string[] = [
        ...(qb.where.mock.calls as string[][]),
        ...(qb.andWhere.mock.calls as string[][]),
      ].map(([sql]) => sql);

      const hasAppearInSearches = allWhereSqls.some((sql) =>
        sql.includes('appearInSearches'),
      );
      expect(hasAppearInSearches).toBe(true);
    });

    it('appearInSearches is combined with mode and connection — not a standalone top-level filter', async () => {
      // Public users must always show even with appearInSearches=false.
      // Private users with an accepted connection must show even with appearInSearches=false.
      // Therefore the flag MUST be inside the same OR clause as mode and chat-request checks.
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      await service.searchByDisplayName('alice', 'user-1');

      // The single combined andWhere must contain all three conditions
      const combinedCall = (qb.andWhere.mock.calls as string[][]).find(
        ([sql]) =>
          sql.includes('appearInSearches') &&
          sql.includes('publicMode') &&
          sql.includes('chat_requests'),
      );
      expect(combinedCall).toBeDefined();

      // There must NOT be a bare standalone appearInSearches andWhere
      const standaloneCall = (qb.andWhere.mock.calls as string[][]).find(
        ([sql]) => sql.trim() === 'user.appearInSearches = TRUE',
      );
      expect(standaloneCall).toBeUndefined();
    });

    it('excludes the current user from results', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      await service.searchByDisplayName('alice', 'user-1');

      const allWhereSqls: string[] = [
        ...(qb.where.mock.calls as string[][]),
        ...(qb.andWhere.mock.calls as string[][]),
      ].map(([sql]) => sql);

      const excludesSelf = allWhereSqls.some((sql) =>
        sql.includes('currentUserId'),
      );
      expect(excludesSelf).toBe(true);
    });

    it('strips a leading @ from the search query', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);

      await service.searchByDisplayName('@alice', 'user-1');

      // The display-name LIKE clause should be called with @alice% not @@alice%
      const allCalls: string[][] = [
        ...(qb.where.mock.calls as string[][]),
        ...(qb.andWhere.mock.calls as string[][]),
      ];
      const displayNameCall = allCalls.find(([sql]) =>
        sql.includes('displayName'),
      );
      expect(displayNameCall).toBeDefined();
      const params = displayNameCall![1] as unknown as { query: string };
      expect(params.query).toBe('@alice%');
    });

    // ── 8 visibility scenarios ────────────────────────────────────────

    // Helper: capture the visibility SQL clause and its params
    const getVisibilityClause = async (): Promise<{
      sql: string;
      params: Record<string, unknown>;
    }> => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);
      await service.searchByDisplayName('alice', 'user-1');
      const calls = qb.andWhere.mock.calls as [
        string,
        Record<string, unknown>,
      ][];
      const call = calls.find(
        ([sql]) =>
          sql.includes('appearInSearches') && sql.includes('chat_requests'),
      )!;
      return { sql: call[0], params: call[1] };
    };

    // Helper: capture the block NOT IN clause SQL
    const getBlockClause = async (): Promise<string> => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);
      await service.searchByDisplayName('alice', 'user-1');
      const calls = qb.andWhere.mock.calls as string[][];
      const call = calls.find(
        ([sql]) => sql.includes('user_blocks') && sql.includes('NOT IN'),
      )!;
      return call[0];
    };

    it('scenario 1: public user with appearInSearches=true appears (mode=PUBLIC branch fires)', async () => {
      const { sql, params } = await getVisibilityClause();
      expect(sql).toMatch(/user\.mode\s*=\s*:publicMode/);
      expect(params.publicMode).toBe(UserMode.PUBLIC);
    });

    it('scenario 2: public user with appearInSearches=false still appears (mode=PUBLIC branch is unconditional)', async () => {
      // mode=PUBLIC must be a peer OR branch, not nested inside an appearInSearches guard.
      // Verified by checking mode comes before appearInSearches in the OR clause.
      const { sql } = await getVisibilityClause();
      const publicModeIdx = sql.indexOf('user.mode');
      const appearInIdx = sql.indexOf('appearInSearches');
      expect(publicModeIdx).toBeGreaterThanOrEqual(0);
      expect(appearInIdx).toBeGreaterThanOrEqual(0);
      // publicMode branch must appear before appearInSearches in the OR expression,
      // confirming it is a standalone peer branch, not nested under the flag.
      expect(publicModeIdx).toBeLessThan(appearInIdx);
    });

    it('scenario 3: private user with appearInSearches=true appears (appearInSearches branch fires independently)', async () => {
      const { sql } = await getVisibilityClause();
      expect(sql).toMatch(/user\.appearInSearches\s*=\s*TRUE/);
    });

    it('scenario 4: private user with appearInSearches=false and no connection is hidden (no branch satisfies)', async () => {
      // The only mode branch targets PUBLIC. PRIVATE has no unconditional pass.
      const { sql, params } = await getVisibilityClause();
      expect(params.publicMode).toBe(UserMode.PUBLIC);
      expect(sql).not.toMatch(/PRIVATE/);
    });

    it('scenario 5: private user with appearInSearches=false but with accepted connection still appears (chat_requests branch fires)', async () => {
      const { sql, params } = await getVisibilityClause();
      expect(sql).toMatch(/chat_requests/);
      expect(sql).toMatch(/cr\.status\s*=\s*:accepted/);
      expect(params.accepted).toBe(ChatRequestStatus.ACCEPTED);
    });

    it('scenario 6: blocked user never appears regardless of mode or appearInSearches (NOT IN applied as top-level AND)', async () => {
      const blockSql = await getBlockClause();
      // Must cover blocker→target direction
      expect(blockSql).toMatch(/blockedId.*blockerId\s*=\s*:currentUserId/s);
      // Must also cover target→blocker direction (bidirectional)
      expect(blockSql).toMatch(/blockerId.*blockedId\s*=\s*:currentUserId/s);
      // It is an AND filter (NOT IN), not inside the visibility OR clause
      expect(blockSql).toMatch(/NOT IN/);
    });

    it('scenario 7: current user never appears in their own search results', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);
      await service.searchByDisplayName('alice', 'user-1');

      const selfExcludeCall = (qb.andWhere.mock.calls as string[][]).find(
        ([sql]) => sql.includes('user.id != :currentUserId'),
      );
      expect(selfExcludeCall).toBeDefined();
    });

    it('scenario 8: pending chat request does not count — private user with appearInSearches=false and only a PENDING request stays hidden', async () => {
      // The EXISTS subquery must filter on status = :accepted (ACCEPTED only).
      // A PENDING status must not satisfy it.
      const { sql, params } = await getVisibilityClause();
      expect(sql).toMatch(/cr\.status\s*=\s*:accepted/);
      expect(params.accepted).toBe(ChatRequestStatus.ACCEPTED);
      // Must not use a weaker check like status != REJECTED or no status filter
      expect(sql).not.toMatch(/cr\.status\s*!=|cr\.status\s*<>/);
    });

    it('scenario 9: block wins over accepted chat — block NOT IN is a top-level AND, so it is evaluated before the visibility OR clause', async () => {
      const qb = qbMock();
      usersRepo.createQueryBuilder.mockReturnValue(qb);
      await service.searchByDisplayName('alice', 'user-1');

      const callOrder = (qb.andWhere.mock.calls as string[][]).map(
        ([sql]) => sql,
      );
      const blockIdx = callOrder.findIndex(
        (sql) => sql.includes('user_blocks') && sql.includes('NOT IN'),
      );
      const visibilityIdx = callOrder.findIndex(
        (sql) =>
          sql.includes('appearInSearches') && sql.includes('chat_requests'),
      );

      // Block NOT IN must be registered as an andWhere before the visibility OR clause
      expect(blockIdx).toBeGreaterThanOrEqual(0);
      expect(visibilityIdx).toBeGreaterThanOrEqual(0);
      expect(blockIdx).toBeLessThan(visibilityIdx);
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
