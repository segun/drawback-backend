import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cache: CacheService,
  ) {}

  async unlockDiscoveryAccess(userId: string): Promise<User> {
    await this.userRepository.update(userId, { hasDiscoveryAccess: true });
    
    // Invalidate user cache so the updated field is immediately visible
    await this.cache.del(`user:${userId}`);
    
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async verifyReceipt(
    userId: string,
    platform: 'ios' | 'android',
    receipt: string,
  ): Promise<{ success: boolean; hasAccess: boolean }> {
    // Placeholder implementation - just grant access for now
    // In production, this would verify with Apple/Google
    await this.unlockDiscoveryAccess(userId);
    return { success: true, hasAccess: true };
  }
}
