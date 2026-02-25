import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordReset1772100000000 implements MigrationInterface {
  name = 'AddPasswordReset1772100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`resetToken\` varchar(128) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`resetTokenExpiry\` datetime NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`resetTokenExpiry\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`users\` DROP COLUMN \`resetToken\``,
    );
  }
}
