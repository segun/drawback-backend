import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActivationTokenExpiry1772200000000
  implements MigrationInterface
{
  name = 'AddActivationTokenExpiry1772200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`activationTokenExpiry\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`activationTokenExpiry\``,
    );
  }
}
