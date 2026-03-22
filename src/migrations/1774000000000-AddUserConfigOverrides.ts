import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserConfigOverrides1774000000000 implements MigrationInterface {
  name = 'AddUserConfigOverrides1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` ADD `configOverrides` json NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` DROP COLUMN `configOverrides`',
    );
  }
}
