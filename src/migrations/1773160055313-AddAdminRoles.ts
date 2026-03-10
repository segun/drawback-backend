import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminRoles1773160055313 implements MigrationInterface {
  name = 'AddAdminRoles1773160055313';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`role\` enum ('USER', 'ADMIN') NOT NULL DEFAULT 'USER'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`isBlocked\` tinyint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`blockedAt\` datetime NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`blockedReason\` varchar(500) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`blockedReason\``,
    );
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`blockedAt\``);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`isBlocked\``);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`role\``);
  }
}
