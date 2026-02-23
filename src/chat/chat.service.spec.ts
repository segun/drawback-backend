import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DrawGateway } from '../realtime/draw.gateway';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { ChatService } from './chat.service';
import { ChatRequest } from './entities/chat-request.entity';
import { SavedChat } from './entities/saved-chat.entity';
import { ChatRequestStatus } from './enums/chat-request-status.enum';

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'alice@example.com',
    displayName: '@alice',
    mode: UserMode.PUBLIC,
    ...overrides,
  }) as User;

const makeRequest = (overrides: Partial<ChatRequest> = {}): ChatRequest =>
  ({
    id: 'req-1',
    fromUserId: 'user-1',
    toUserId: 'user-2',
    status: ChatRequestStatus.PENDING,
    ...overrides,
  }) as ChatRequest;

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

type MockedUsersService = {
  findById: jest.Mock;
  findByDisplayName: jest.Mock;
  isBlocked: jest.Mock;
};

type MockedDrawGateway = {
  notifyChatRequested: jest.Mock;
  notifyChatResponse: jest.Mock;
};

describe('ChatService', () => {
  let service: ChatService;
  let chatRequestRepo: ReturnType<typeof repoMock>;
  let savedChatsRepo: ReturnType<typeof repoMock>;
  let usersService: MockedUsersService;
  let drawGateway: MockedDrawGateway;

  beforeEach(async () => {
    chatRequestRepo = repoMock();
    savedChatsRepo = repoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatRequest), useValue: chatRequestRepo },
        { provide: getRepositoryToken(SavedChat), useValue: savedChatsRepo },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
            findByDisplayName: jest.fn(),
            isBlocked: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: DrawGateway,
          useValue: {
            notifyChatRequested: jest.fn(),
            notifyChatResponse: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ChatService);
    chatRequestRepo = module.get(getRepositoryToken(ChatRequest));
    savedChatsRepo = module.get(getRepositoryToken(SavedChat));
    usersService = module.get<MockedUsersService>(UsersService);
    drawGateway = module.get<MockedDrawGateway>(DrawGateway);
  });

  afterEach(() => jest.clearAllMocks());

  // ── createRequest ────────────────────────────────────────────────────

  describe('createRequest', () => {
    const dto = { toDisplayName: '@bob' };
    const fromUser = makeUser({ id: 'user-1', displayName: '@alice' });
    const toUser = makeUser({
      id: 'user-2',
      displayName: '@bob',
      mode: UserMode.PUBLIC,
    });

    beforeEach(() => {
      usersService.findById.mockResolvedValue(fromUser);
      usersService.findByDisplayName.mockResolvedValue(toUser);
      usersService.isBlocked.mockResolvedValue(false);
      chatRequestRepo.findOne.mockResolvedValue(null);
      chatRequestRepo.create.mockReturnValue(makeRequest());
      chatRequestRepo.save.mockResolvedValue(makeRequest());
    });

    it('creates and returns a chat request', async () => {
      const result = await service.createRequest('user-1', dto);

      expect(chatRequestRepo.save).toHaveBeenCalledTimes(1);
      expect(drawGateway.notifyChatRequested).toHaveBeenCalledWith(
        toUser.id,
        expect.objectContaining({ requestId: 'req-1' }),
      );
      expect(result.id).toBe('req-1');
    });

    it('throws BadRequestException when chatting with self', async () => {
      usersService.findByDisplayName.mockResolvedValue(fromUser); // same user

      await expect(service.createRequest('user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when target user does not exist', async () => {
      usersService.findByDisplayName.mockResolvedValue(null);

      await expect(service.createRequest('user-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when blocked', async () => {
      usersService.isBlocked.mockResolvedValue(true);

      await expect(service.createRequest('user-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when target user is PRIVATE', async () => {
      usersService.findByDisplayName.mockResolvedValue({
        ...toUser,
        mode: UserMode.PRIVATE,
      } as User);

      await expect(service.createRequest('user-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when duplicate PENDING request exists', async () => {
      chatRequestRepo.findOne.mockResolvedValue(makeRequest());

      await expect(service.createRequest('user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── respondToRequest ─────────────────────────────────────────────────

  describe('respondToRequest', () => {
    it('accepts request and emits response to both parties', async () => {
      const req = makeRequest({ toUserId: 'user-2' });
      chatRequestRepo.findOne.mockResolvedValue(req);
      chatRequestRepo.save.mockResolvedValue({
        ...req,
        status: ChatRequestStatus.ACCEPTED,
      });

      const result = await service.respondToRequest('req-1', 'user-2', {
        accept: true,
      });

      expect(result.request.status).toBe(ChatRequestStatus.ACCEPTED);
      expect(result.roomId).toBe('chat:req-1');
      expect(drawGateway.notifyChatResponse).toHaveBeenCalledTimes(2);
    });

    it('rejects request and returns null roomId', async () => {
      const req = makeRequest({ toUserId: 'user-2' });
      chatRequestRepo.findOne.mockResolvedValue(req);
      chatRequestRepo.save.mockResolvedValue({
        ...req,
        status: ChatRequestStatus.REJECTED,
      });

      const result = await service.respondToRequest('req-1', 'user-2', {
        accept: false,
      });

      expect(result.roomId).toBeNull();
    });

    it('throws ForbiddenException when non-recipient tries to respond', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({ toUserId: 'user-2' }),
      );

      await expect(
        service.respondToRequest('req-1', 'user-1', { accept: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when request is already resolved', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({ status: ChatRequestStatus.ACCEPTED }),
      );

      await expect(
        service.respondToRequest('req-1', 'user-2', { accept: true }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── cancelRequest ─────────────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('removes request when sender cancels', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({ fromUserId: 'user-1' }),
      );
      chatRequestRepo.remove.mockResolvedValue({});

      await service.cancelRequest('req-1', 'user-1');

      expect(chatRequestRepo.remove).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when non-sender tries to cancel', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({ fromUserId: 'user-1' }),
      );

      await expect(service.cancelRequest('req-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException for already-resolved request', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({
          status: ChatRequestStatus.ACCEPTED,
          fromUserId: 'user-1',
        }),
      );

      await expect(service.cancelRequest('req-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── saveChat ─────────────────────────────────────────────────────────

  describe('saveChat', () => {
    const acceptedReq = makeRequest({
      fromUserId: 'user-1',
      toUserId: 'user-2',
      status: ChatRequestStatus.ACCEPTED,
    });

    it('saves and returns a SavedChat record', async () => {
      chatRequestRepo.findOne.mockResolvedValue(acceptedReq);
      savedChatsRepo.findOne.mockResolvedValue(null);
      const saved = {
        id: 'saved-1',
        chatRequestId: 'req-1',
        savedByUserId: 'user-1',
      } as SavedChat;
      savedChatsRepo.create.mockReturnValue(saved);
      savedChatsRepo.save.mockResolvedValue(saved);

      const result = await service.saveChat('req-1', 'user-1');

      expect(savedChatsRepo.save).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('saved-1');
    });

    it('is idempotent when chat is already saved', async () => {
      const existingRecord = { id: 'saved-1' } as SavedChat;
      chatRequestRepo.findOne.mockResolvedValue(acceptedReq);
      savedChatsRepo.findOne.mockResolvedValue(existingRecord);

      const result = await service.saveChat('req-1', 'user-1');

      expect(savedChatsRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual(existingRecord);
    });

    it('throws ForbiddenException when user is not part of chat', async () => {
      chatRequestRepo.findOne.mockResolvedValue(acceptedReq);

      await expect(service.saveChat('req-1', 'user-3')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws BadRequestException when request is not accepted', async () => {
      chatRequestRepo.findOne.mockResolvedValue(
        makeRequest({ status: ChatRequestStatus.PENDING }),
      );

      await expect(service.saveChat('req-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── deleteSavedChat ───────────────────────────────────────────────────

  describe('deleteSavedChat', () => {
    it('removes saved chat for its owner', async () => {
      const saved = { id: 'saved-1', savedByUserId: 'user-1' } as SavedChat;
      savedChatsRepo.findOne.mockResolvedValue(saved);
      savedChatsRepo.remove.mockResolvedValue({});

      await service.deleteSavedChat('saved-1', 'user-1');

      expect(savedChatsRepo.remove).toHaveBeenCalledWith(saved);
    });

    it('throws ForbiddenException when non-owner tries to delete', async () => {
      savedChatsRepo.findOne.mockResolvedValue({
        id: 'saved-1',
        savedByUserId: 'user-1',
      } as SavedChat);

      await expect(
        service.deleteSavedChat('saved-1', 'user-2'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when saved chat not found', async () => {
      savedChatsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deleteSavedChat('missing', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
