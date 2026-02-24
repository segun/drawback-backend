import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppearInSearches1772000000000 implements MigrationInterface {
    name = 'AddAppearInSearches1772000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` ADD \`appearInSearches\` tinyint NOT NULL DEFAULT 1`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`appearInSearches\``);
    }
}
