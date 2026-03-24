import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppConfig,
  AppConfigData,
  UserConfigOverridesData,
} from './entities/app-config.entity';
import { User } from '../users/entities/user.entity';

const DEFAULT_CONFIG: AppConfigData = {
  ads: { provider: '' },
  temporaryDiscoveryAccessDurationMinutes: 5,
};

const normalizeConfig = (
  config: Partial<AppConfigData> | null | undefined,
): AppConfigData => ({
  ads: {
    provider:
      typeof config?.ads?.provider === 'string'
        ? config.ads.provider
        : DEFAULT_CONFIG.ads.provider,
  },
  temporaryDiscoveryAccessDurationMinutes:
    Number.isInteger(config?.temporaryDiscoveryAccessDurationMinutes) &&
    (config?.temporaryDiscoveryAccessDurationMinutes ?? 0) > 0
      ? (config?.temporaryDiscoveryAccessDurationMinutes as number)
      : DEFAULT_CONFIG.temporaryDiscoveryAccessDurationMinutes,
});

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
    return normalizeConfig(record?.config);
  }

  async setConfig(data: AppConfigData): Promise<AppConfigData> {
    const normalized = normalizeConfig(data);
    const records = await this.appConfigRepository.find({ take: 1 });
    const record = records[0] ?? this.appConfigRepository.create();
    record.config = normalized;
    await this.appConfigRepository.save(record);
    return normalized;
  }

  async getUserConfigOverrides(
    userId: string,
  ): Promise<UserConfigOverridesData | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.configOverrides ?? null;
  }

  async setUserConfigOverrides(
    userId: string,
    overrides: UserConfigOverridesData | null,
  ): Promise<UserConfigOverridesData | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.configOverrides = overrides ?? null;
    await this.userRepository.save(user);
    return user.configOverrides;
  }
}
