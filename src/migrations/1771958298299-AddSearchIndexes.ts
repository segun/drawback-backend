import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSearchIndexes1771958298299 implements MigrationInterface {
    name = 'AddSearchIndexes1771958298299'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX \`idx_user_blocks_blockedId\` ON \`user_blocks\` (\`blockedId\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_chat_requests_toUserId_status\` ON \`chat_requests\` (\`toUserId\`, \`status\`)`);
        await queryRunner.query(`CREATE INDEX \`idx_chat_requests_fromUserId_status\` ON \`chat_requests\` (\`fromUserId\`, \`status\`)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_chat_requests_fromUserId_status\` ON \`chat_requests\``);
        await queryRunner.query(`DROP INDEX \`idx_chat_requests_toUserId_status\` ON \`chat_requests\``);
        await queryRunner.query(`DROP INDEX \`idx_user_blocks_blockedId\` ON \`user_blocks\``);
    }

}
