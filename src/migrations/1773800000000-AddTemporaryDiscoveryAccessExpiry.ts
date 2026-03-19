import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemporaryDiscoveryAccessExpiry1773800000000 implements MigrationInterface {
  name = 'AddTemporaryDiscoveryAccessExpiry1773800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` ADD `temporaryDiscoveryAccessExpiresAt` datetime NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` DROP COLUMN `temporaryDiscoveryAccessExpiresAt`',
    );
  }
}
