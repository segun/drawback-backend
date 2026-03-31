import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupChat1774500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`group_chats\` (
        \`id\` varchar(36) NOT NULL,
        \`name\` varchar(100) NOT NULL,
        \`createdByUserId\` varchar(36) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`fk_group_chats_createdBy\`
          FOREIGN KEY (\`createdByUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE \`group_chat_members\` (
        \`id\` varchar(36) NOT NULL,
        \`groupChatId\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`role\` enum('OWNER','MEMBER') NOT NULL DEFAULT 'MEMBER',
        \`joinedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_group_chat_members_groupUser\` (\`groupChatId\`, \`userId\`),
        CONSTRAINT \`fk_group_chat_members_group\`
          FOREIGN KEY (\`groupChatId\`) REFERENCES \`group_chats\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_group_chat_members_user\`
          FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`group_chat_members\``);
    await queryRunner.query(`DROP TABLE \`group_chats\``);
  }
}
