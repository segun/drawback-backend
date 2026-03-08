import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDiscoveryGame1772400000000 implements MigrationInterface {
  name = 'AddDiscoveryGame1772400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`appearInDiscoveryGame\` tinyint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`discoveryImageUrl\` varchar(512) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`discoveryImageUrl\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`appearInDiscoveryGame\``,
    );
  }
}
