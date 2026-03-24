import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPushTokens1774301215220 implements MigrationInterface {
  name = 'AddPushTokens1774301215220';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`push_tokens\` (\`id\` varchar(36) NOT NULL, \`userId\` varchar(36) NOT NULL, \`provider\` enum ('fcm') NOT NULL, \`token\` varchar(512) NOT NULL, \`platform\` enum ('ios', 'android') NOT NULL, \`deviceId\` varchar(255) NOT NULL, \`active\` tinyint NOT NULL DEFAULT 1, \`deactivationReason\` varchar(100) NULL, \`lastSeenAt\` datetime NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`UQ_push_tokens_provider_token\` (\`provider\`, \`token\`), INDEX \`IDX_push_tokens_user_active\` (\`userId\`, \`active\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`push_tokens\` ADD CONSTRAINT \`FK_95b226ff93ba9b9edfd06136be0\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`push_tokens\` DROP FOREIGN KEY \`FK_95b226ff93ba9b9edfd06136be0\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_push_tokens_user_active\` ON \`push_tokens\``,
    );
    await queryRunner.query(
      `DROP INDEX \`UQ_push_tokens_provider_token\` ON \`push_tokens\``,
    );
    await queryRunner.query(`DROP TABLE \`push_tokens\``);
  }
}
