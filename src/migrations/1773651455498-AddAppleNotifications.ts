import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppleNotifications1773651455498 implements MigrationInterface {
  name = 'AddAppleNotifications1773651455498';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_subscriptions_user\``,
    );
    await queryRunner.query(
      `DROP INDEX \`idx_subscriptions_endDate\` ON \`subscriptions\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_subscriptions_userId\` ON \`subscriptions\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_admin_audit_logs_adminId_createdAt\` ON \`admin_audit_logs\``,
    );
    await queryRunner.query(
      `CREATE TABLE \`apple_notifications\` (\`id\` varchar(36) NOT NULL, \`notificationUUID\` varchar(255) NOT NULL, \`notificationType\` varchar(50) NOT NULL, \`originalTransactionId\` varchar(255) NULL, \`rawPayload\` text NULL, \`processedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_ade675936823cf4a23e7b32b05\` (\`notificationUUID\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD UNIQUE INDEX \`IDX_fbdba4e2ac694cf8c9cecf4dc8\` (\`userId\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`admin_audit_logs\` DROP COLUMN \`adminId\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`admin_audit_logs\` ADD \`adminId\` varchar(255) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`REL_fbdba4e2ac694cf8c9cecf4dc8\` ON \`subscriptions\` (\`userId\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_f9f36bfd0c64d8f4ad75e30e10\` ON \`admin_audit_logs\` (\`adminId\`, \`createdAt\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_fbdba4e2ac694cf8c9cecf4dc84\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP FOREIGN KEY \`FK_fbdba4e2ac694cf8c9cecf4dc84\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_f9f36bfd0c64d8f4ad75e30e10\` ON \`admin_audit_logs\``,
    );
    await queryRunner.query(
      `DROP INDEX \`REL_fbdba4e2ac694cf8c9cecf4dc8\` ON \`subscriptions\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`admin_audit_logs\` DROP COLUMN \`adminId\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`admin_audit_logs\` ADD \`adminId\` varchar(36) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` DROP INDEX \`IDX_fbdba4e2ac694cf8c9cecf4dc8\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_ade675936823cf4a23e7b32b05\` ON \`apple_notifications\``,
    );
    await queryRunner.query(`DROP TABLE \`apple_notifications\``);
    await queryRunner.query(
      `CREATE INDEX \`IDX_admin_audit_logs_adminId_createdAt\` ON \`admin_audit_logs\` (\`adminId\`, \`createdAt\`)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_subscriptions_userId\` ON \`subscriptions\` (\`userId\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_subscriptions_endDate\` ON \`subscriptions\` (\`endDate\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` ADD CONSTRAINT \`FK_subscriptions_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
