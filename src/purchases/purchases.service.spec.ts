import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PurchasesService } from './purchases.service';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../users/entities/subscription.entity';

const repoMock = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
});

describe('PurchasesService', () => {
  let service: PurchasesService;
  let userRepository: ReturnType<typeof repoMock>;
  let subscriptionRepository: ReturnType<typeof repoMock>;
  let configService: { get: jest.Mock };
  let fetchMock: jest.Mock;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    userRepository = repoMock();
    subscriptionRepository = repoMock();

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'APPLE_SHARED_SECRET') {
          return 'shared-secret';
        }
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Subscription),
          useValue: subscriptionRepository,
        },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PurchasesService);
    userRepository = module.get(getRepositoryToken(User));
    subscriptionRepository = module.get(getRepositoryToken(Subscription));

    fetchMock = jest.fn();
    originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('verifies iOS receipt using 21007 fallback and updates subscription', async () => {
    const now = Date.now();
    const purchaseDate = String(now - 3 * 24 * 60 * 60 * 1000);
    const expiryDate = String(now + 30 * 24 * 60 * 60 * 1000);

    fetchMock
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 21007 }),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            status: 0,
            latest_receipt_info: [
              {
                product_id: 'monthly',
                purchase_date_ms: purchaseDate,
                expires_date_ms: expiryDate,
                original_transaction_id: 'orig-tx-1',
              },
            ],
            pending_renewal_info: [
              {
                product_id: 'monthly',
                auto_renew_status: '1',
                original_transaction_id: 'orig-tx-1',
              },
            ],
          }),
      });

    subscriptionRepository.findOne.mockResolvedValue({ id: 'sub-1' });

    const result = await service.verifyReceipt(
      'user-1',
      'ios',
      'encoded-receipt',
      'monthly',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://buy.itunes.apple.com/verifyReceipt',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sandbox.itunes.apple.com/verifyReceipt',
      expect.objectContaining({ method: 'POST' }),
    );

    expect(subscriptionRepository.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        platform: 'ios',
        tier: 'monthly',
        status: 'active',
        autoRenew: true,
        originalTransactionId: 'orig-tx-1',
      }),
    );
    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      hasDiscoveryAccess: true,
    });

    expect(result.success).toBe(true);
    expect(result.subscription?.platform).toBe('ios');
    expect(result.subscription?.tier).toBe('monthly');
    expect(result.subscription?.autoRenew).toBe(true);
  });

  it('rejects expired iOS receipts', async () => {
    const now = Date.now();
    fetchMock.mockResolvedValue({
      json: () =>
        Promise.resolve({
          status: 0,
          latest_receipt_info: [
            {
              product_id: 'monthly',
              purchase_date_ms: String(now - 60 * 24 * 60 * 60 * 1000),
              expires_date_ms: String(now - 10 * 24 * 60 * 60 * 1000),
              original_transaction_id: 'orig-tx-2',
            },
          ],
          pending_renewal_info: [],
        }),
    });

    await expect(
      service.verifyReceipt('user-1', 'ios', 'encoded-receipt', 'monthly'),
    ).rejects.toThrow(BadRequestException);

    expect(subscriptionRepository.update).not.toHaveBeenCalled();
    expect(subscriptionRepository.save).not.toHaveBeenCalled();
  });

  it('throws when APPLE_SHARED_SECRET is missing', async () => {
    configService.get.mockImplementation(() => undefined);

    await expect(
      service.verifyReceipt('user-1', 'ios', 'encoded-receipt', 'monthly'),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('verifies StoreKit 2 JWS transaction when receipt starts with eyJ', async () => {
    const now = Date.now();
    const purchaseDate = now - 3 * 24 * 60 * 60 * 1000;
    const expiryDate = now + 30 * 24 * 60 * 60 * 1000;

    // Mock the Apple verifier
    const mockVerifier = {
      verifyAndDecodeTransaction: jest.fn().mockResolvedValue({
        productId: 'monthly',
        originalTransactionId: 'orig-tx-storekit2',
        purchaseDate,
        expiresDate: expiryDate,
        transactionId: 'tx-123',
      }),
    };

    // Inject the mock verifier
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (service as any).appleVerifier = mockVerifier;

    subscriptionRepository.findOne.mockResolvedValue({ id: 'sub-1' });

    const jwsTransaction =
      'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlFTVRDQ0E3YWdBd0lC...';

    const result = await service.verifyReceipt(
      'user-1',
      'ios',
      jwsTransaction,
      'monthly',
    );

    expect(mockVerifier.verifyAndDecodeTransaction).toHaveBeenCalledWith(
      jwsTransaction,
    );
    expect(fetchMock).not.toHaveBeenCalled(); // Should NOT use legacy verifyReceipt

    expect(subscriptionRepository.update).toHaveBeenCalledWith(
      'sub-1',
      expect.objectContaining({
        platform: 'ios',
        tier: 'monthly',
        status: 'active',
        autoRenew: true,
        originalTransactionId: 'orig-tx-storekit2',
      }),
    );
    expect(userRepository.update).toHaveBeenCalledWith('user-1', {
      hasDiscoveryAccess: true,
    });

    expect(result.success).toBe(true);
    expect(result.subscription?.platform).toBe('ios');
    expect(result.subscription?.tier).toBe('monthly');
  });

  it('rejects JWS transaction if verifier is not initialized', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (service as any).appleVerifier = null;

    const jwsTransaction =
      'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlFTVRDQ0E3YWdBd0lC...';

    await expect(
      service.verifyReceipt('user-1', 'ios', jwsTransaction, 'monthly'),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects JWS transaction with expired subscription', async () => {
    const now = Date.now();
    const mockVerifier = {
      verifyAndDecodeTransaction: jest.fn().mockResolvedValue({
        productId: 'monthly',
        originalTransactionId: 'orig-tx-expired',
        purchaseDate: now - 60 * 24 * 60 * 60 * 1000,
        expiresDate: now - 10 * 24 * 60 * 60 * 1000, // Expired
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    (service as any).appleVerifier = mockVerifier;

    const jwsTransaction =
      'eyJhbGciOiJFUzI1NiIsIng1YyI6WyJNSUlFTVRDQ0E3YWdBd0lC...';

    await expect(
      service.verifyReceipt('user-1', 'ios', jwsTransaction, 'monthly'),
    ).rejects.toThrow(BadRequestException);

    expect(subscriptionRepository.update).not.toHaveBeenCalled();
    expect(subscriptionRepository.save).not.toHaveBeenCalled();
  });
});
