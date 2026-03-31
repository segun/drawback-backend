import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionVersionToUsers1774400000000 implements MigrationInterface {
  name = 'AddSessionVersionToUsers1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` ADD `sessionVersion` int NOT NULL DEFAULT 0',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `sessionVersion`');
  }
}
