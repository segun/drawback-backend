import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReports1773200000000 implements MigrationInterface {
  name = 'AddReports1773200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`reports\` (
        \`id\` varchar(36) NOT NULL,
        \`reporterId\` varchar(36) NOT NULL,
        \`reportedUserId\` varchar(36) NOT NULL,
        \`reportType\` enum('INAPPROPRIATE_CONTENT', 'HARASSMENT', 'CSAE', 'SPAM', 'IMPERSONATION', 'OTHER') NOT NULL,
        \`description\` text NOT NULL,
        \`chatRequestId\` varchar(36) NULL,
        \`sessionContext\` varchar(255) NULL,
        \`status\` enum('PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
        \`adminNotes\` text NULL,
        \`resolvedBy\` varchar(36) NULL,
        \`resolvedAt\` timestamp NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_reports_reporterId\` (\`reporterId\`),
        INDEX \`IDX_reports_reportedUserId\` (\`reportedUserId\`),
        INDEX \`IDX_reports_status\` (\`status\`),
        INDEX \`IDX_reports_reportType\` (\`reportType\`),
        INDEX \`IDX_reports_createdAt\` (\`createdAt\`),
        CONSTRAINT \`FK_reports_reporterId\` FOREIGN KEY (\`reporterId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_reports_reportedUserId\` FOREIGN KEY (\`reportedUserId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_reports_resolvedBy\` FOREIGN KEY (\`resolvedBy\`) REFERENCES \`users\`(\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`reports\``);
  }
}
