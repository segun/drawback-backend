import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebAuthnCredentials1773300000000 implements MigrationInterface {
  name = 'AddWebAuthnCredentials1773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`credentials\` (
        \`id\` varchar(36) NOT NULL,
        \`userId\` varchar(36) NOT NULL,
        \`credentialId\` blob NOT NULL,
        \`publicKey\` blob NOT NULL,
        \`counter\` bigint NOT NULL DEFAULT 0,
        \`transports\` json NULL,
        \`lastUsedAt\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        INDEX \`IDX_credentials_userId\` (\`userId\`),
        INDEX \`IDX_credentials_credentialId\` (\`credentialId\`(255)),
        UNIQUE INDEX \`UQ_credentials_credentialId\` (\`credentialId\`(255)),
        CONSTRAINT \`FK_credentials_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`credentials\``);
  }
}
