import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1771868434279 implements MigrationInterface {
    name = 'InitialSchema1771868434279'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`users\` (\`id\` varchar(36) NOT NULL, \`email\` varchar(254) NOT NULL, \`passwordHash\` varchar(255) NOT NULL, \`displayName\` varchar(30) NOT NULL, \`isActivated\` tinyint NOT NULL DEFAULT 0, \`activationToken\` varchar(128) NULL, \`mode\` enum ('PUBLIC', 'PRIVATE') NOT NULL DEFAULT 'PRIVATE', \`socketId\` varchar(128) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_97672ac88f789774dd47f7c8be\` (\`email\`), UNIQUE INDEX \`IDX_31daa51074a24fcfcee3c4f08b\` (\`displayName\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`user_blocks\` (\`id\` varchar(36) NOT NULL, \`blockerId\` varchar(255) NOT NULL, \`blockedId\` varchar(255) NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_fc74151c76df192714f76b2a2e\` (\`blockerId\`, \`blockedId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`chat_requests\` (\`id\` varchar(36) NOT NULL, \`fromUserId\` varchar(255) NOT NULL, \`toUserId\` varchar(255) NOT NULL, \`status\` enum ('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING', \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`saved_chats\` (\`id\` varchar(36) NOT NULL, \`chatRequestId\` varchar(255) NOT NULL, \`savedByUserId\` varchar(255) NOT NULL, \`savedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_e01f040ba80526b27dab1e7970\` (\`chatRequestId\`, \`savedByUserId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` ADD CONSTRAINT \`FK_eae09d4f95afa5ae30c28384607\` FOREIGN KEY (\`blockerId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` ADD CONSTRAINT \`FK_18d34df8212648b698828f244fb\` FOREIGN KEY (\`blockedId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chat_requests\` ADD CONSTRAINT \`FK_710a335cba1c87e3bc45862e01a\` FOREIGN KEY (\`fromUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`chat_requests\` ADD CONSTRAINT \`FK_fe0a86fa0df54ec0af4baf25a19\` FOREIGN KEY (\`toUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`saved_chats\` ADD CONSTRAINT \`FK_44fc12d8b15254d0aee5142c1fe\` FOREIGN KEY (\`chatRequestId\`) REFERENCES \`chat_requests\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`saved_chats\` ADD CONSTRAINT \`FK_3a1540ac7831d3b60db549f7388\` FOREIGN KEY (\`savedByUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`saved_chats\` DROP FOREIGN KEY \`FK_3a1540ac7831d3b60db549f7388\``);
        await queryRunner.query(`ALTER TABLE \`saved_chats\` DROP FOREIGN KEY \`FK_44fc12d8b15254d0aee5142c1fe\``);
        await queryRunner.query(`ALTER TABLE \`chat_requests\` DROP FOREIGN KEY \`FK_fe0a86fa0df54ec0af4baf25a19\``);
        await queryRunner.query(`ALTER TABLE \`chat_requests\` DROP FOREIGN KEY \`FK_710a335cba1c87e3bc45862e01a\``);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` DROP FOREIGN KEY \`FK_18d34df8212648b698828f244fb\``);
        await queryRunner.query(`ALTER TABLE \`user_blocks\` DROP FOREIGN KEY \`FK_eae09d4f95afa5ae30c28384607\``);
        await queryRunner.query(`DROP INDEX \`IDX_e01f040ba80526b27dab1e7970\` ON \`saved_chats\``);
        await queryRunner.query(`DROP TABLE \`saved_chats\``);
        await queryRunner.query(`DROP TABLE \`chat_requests\``);
        await queryRunner.query(`DROP INDEX \`IDX_fc74151c76df192714f76b2a2e\` ON \`user_blocks\``);
        await queryRunner.query(`DROP TABLE \`user_blocks\``);
        await queryRunner.query(`DROP INDEX \`IDX_31daa51074a24fcfcee3c4f08b\` ON \`users\``);
        await queryRunner.query(`DROP INDEX \`IDX_97672ac88f789774dd47f7c8be\` ON \`users\``);
        await queryRunner.query(`DROP TABLE \`users\``);
    }

}
