import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeleteToken1772600000000 implements MigrationInterface {
  name = 'AddDeleteToken1772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`deleteToken\` varchar(128) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`deleteTokenExpiry\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`deleteTokenExpiry\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`deleteToken\``,
    );
  }
}
