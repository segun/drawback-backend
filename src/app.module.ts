import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { MailModule } from './mail/mail.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 3 },
      { name: 'auth', ttl: 60000, limit: 10 },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const require = (key: string): string => {
          const value = config.get<string>(key);
          if (value === undefined || value === null || value === '') {
            throw new Error(`Missing required environment variable: ${key}`);
          }
          return value;
        };

        return {
          type: 'mysql',
          host: require('DB_HOST'),
          port: Number(require('DB_PORT')),
          username: require('DB_USER'),
          password: require('DB_PASSWORD'),
          database: require('DB_NAME'),
          synchronize: false,
          migrations: ['dist/migrations/*.js'],
          migrationsRun: false,
          autoLoadEntities: true,
          // Allow enough connections for PM2 cluster workers.
          // Formula: pool_size_per_worker × num_workers ≤ MySQL max_connections.
          // Default MySQL max_connections is 151; 20 per worker × 4 workers = 80.
          extra: {
            connectionLimit: Number(config.get('DB_POOL_SIZE') ?? 20),
          },
        };
      },
    }),
    MailModule,
    AuthModule,
    UsersModule,
    ChatModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
