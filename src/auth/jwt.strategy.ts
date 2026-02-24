import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { User } from '../users/entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const TTL_USER = 3600; // seconds — must match UsersService

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly cache: CacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'changeme-secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const key = `user:${payload.sub}`;

    const cached = await this.cache.getInstance(key, User);
    if (cached) {
      if (!cached.isActivated) throw new UnauthorizedException();
      return cached;
    }

    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user || !user.isActivated) {
      throw new UnauthorizedException();
    }

    await this.cache.set(key, user, TTL_USER);
    return user;
  }
}
