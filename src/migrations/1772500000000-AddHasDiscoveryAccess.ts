import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHasDiscoveryAccess1772500000000 implements MigrationInterface {
  name = 'AddHasDiscoveryAccess1772500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`hasDiscoveryAccess\` tinyint NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`hasDiscoveryAccess\``,
    );
  }
}
