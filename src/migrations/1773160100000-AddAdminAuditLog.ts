import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminAuditLog1773160100000 implements MigrationInterface {
    name = 'AddAdminAuditLog1773160100000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE \`admin_audit_logs\` (
                \`id\` varchar(36) NOT NULL,
                \`adminId\` varchar(36) NOT NULL,
                \`action\` enum ('BAN_USER', 'UNBAN_USER', 'RESET_PASSWORD', 'UPDATE_ROLE') NOT NULL,
                \`targetUserIds\` json NOT NULL,
                \`metadata\` json NULL,
                \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                INDEX \`IDX_admin_audit_logs_adminId_createdAt\` (\`adminId\`, \`createdAt\`),
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`admin_audit_logs\``);
    }
}
