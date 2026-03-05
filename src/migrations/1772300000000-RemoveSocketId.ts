import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveSocketId1772300000000 implements MigrationInterface {
  name = 'RemoveSocketId1772300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`socketId\``);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`socketId\` varchar(128) NULL`,
    );
  }
}
