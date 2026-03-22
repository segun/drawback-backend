import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig, AppConfigData } from './entities/app-config.entity';
import { User } from '../users/entities/user.entity';

const DEFAULT_CONFIG: AppConfigData = {
  ads: { provider: '' },
};

@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(AppConfig)
    private readonly appConfigRepository: Repository<AppConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getConfig(): Promise<AppConfigData> {
    const records = await this.appConfigRepository.find({ take: 1 });
    const record = records[0];
    if (!record) {
      return DEFAULT_CONFIG;
    }
    return {
      ads: {
        provider: record.config?.ads?.provider ?? DEFAULT_CONFIG.ads.provider,
      },
    };
  }

  async setConfig(data: AppConfigData): Promise<AppConfigData> {
    const records = await this.appConfigRepository.find({ take: 1 });
    const record = records[0] ?? this.appConfigRepository.create();
    record.config = data;
    await this.appConfigRepository.save(record);
    return data;
  }

  async getUserConfigOverrides(
    userId: string,
  ): Promise<{ ads?: { provider?: string } } | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.configOverrides ?? null;
  }

  async setUserConfigOverrides(
    userId: string,
    overrides: { ads?: { provider?: string } } | null,
  ): Promise<{ ads?: { provider?: string } } | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.configOverrides = overrides ?? null;
    await this.userRepository.save(user);
    return user.configOverrides;
  }
}
