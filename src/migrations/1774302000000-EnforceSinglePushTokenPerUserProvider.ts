import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceSinglePushTokenPerUserProvider1774302000000
  implements MigrationInterface
{
  name = 'EnforceSinglePushTokenPerUserProvider1774302000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Keep only the most recently updated row for each user+provider pair.
    await queryRunner.query(`
      DELETE pt1
      FROM push_tokens pt1
      JOIN push_tokens pt2
        ON pt1.userId = pt2.userId
       AND pt1.provider = pt2.provider
       AND (
         pt1.updatedAt < pt2.updatedAt
         OR (pt1.updatedAt = pt2.updatedAt AND pt1.id < pt2.id)
       )
    `);

    await queryRunner.query(
      'CREATE UNIQUE INDEX `UQ_push_tokens_user_provider` ON `push_tokens` (`userId`, `provider`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `UQ_push_tokens_user_provider` ON `push_tokens`',
    );
  }
}
