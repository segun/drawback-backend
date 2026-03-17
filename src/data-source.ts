import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './users/entities/user.entity';
import { UserBlock } from './users/entities/user-block.entity';
import { Subscription } from './users/entities/subscription.entity';
import { ChatRequest } from './chat/entities/chat-request.entity';
import { SavedChat } from './chat/entities/saved-chat.entity';
import { AdminAuditLog } from './admin/entities/admin-audit-log.entity';
import { AppleNotification } from './purchases/entities/apple-notification.entity';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export default new DataSource({
  type: 'mysql',
  host: required('DB_HOST'),
  port: Number(required('DB_PORT')),
  username: required('DB_USER'),
  password: required('DB_PASSWORD'),
  database: required('DB_NAME'),
  entities: [
    User,
    UserBlock,
    Subscription,
    ChatRequest,
    SavedChat,
    AdminAuditLog,
    AppleNotification,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
