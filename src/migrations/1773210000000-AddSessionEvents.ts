import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionEvents1773210000000 implements MigrationInterface {
  name = 'AddSessionEvents1773210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`session_events\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`eventType\` enum('CONNECT', 'DISCONNECT', 'CHAT_JOINED', 'CHAT_LEFT') NOT NULL,
        \`ipAddress\` varchar(45) NULL,
        \`metadata\` json NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_session_events_userId\` (\`userId\`),
        INDEX \`IDX_session_events_eventType\` (\`eventType\`),
        INDEX \`IDX_session_events_createdAt\` (\`createdAt\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`session_events\``);
  }
}
