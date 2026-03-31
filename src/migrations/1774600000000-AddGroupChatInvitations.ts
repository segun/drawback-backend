import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupChatInvitations1774600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`group_chat_invitations\` (
        \`id\` varchar(36) NOT NULL,
        \`groupChatId\` varchar(36) NOT NULL,
        \`inviterUserId\` varchar(36) NOT NULL,
        \`inviteeUserId\` varchar(36) NOT NULL,
        \`status\` enum('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_gci_inviteeId_status\` (\`inviteeUserId\`, \`status\`),
        KEY \`idx_gci_groupId_inviteeId\` (\`groupChatId\`, \`inviteeUserId\`),
        CONSTRAINT \`fk_gci_group\` FOREIGN KEY (\`groupChatId\`) REFERENCES \`group_chats\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_gci_inviter\` FOREIGN KEY (\`inviterUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_gci_invitee\` FOREIGN KEY (\`inviteeUserId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`group_chat_invitations\``);
  }
}
