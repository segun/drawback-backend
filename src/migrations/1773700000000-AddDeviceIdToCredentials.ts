import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceIdToCredentials1773700000000 implements MigrationInterface {
  name = 'AddDeviceIdToCredentials1773700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`credentials\` ADD \`deviceId\` varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`credentials\` ADD \`platform\` varchar(50) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`credentials\` DROP COLUMN \`platform\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`credentials\` DROP COLUMN \`deviceId\``,
    );
  }
}
