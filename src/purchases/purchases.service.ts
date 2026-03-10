import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

@Injectable()
export class PurchasesService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async unlockDiscoveryAccess(userId: string): Promise<User> {
    await this.userRepository.update(userId, { hasDiscoveryAccess: true });

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
