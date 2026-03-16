import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseSubscriptionTierLength1773600000000
  implements MigrationInterface
{
  name = 'IncreaseSubscriptionTierLength1773600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Increase tier column length to accommodate longer product IDs like 'discovery_unlock_forever'
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` MODIFY COLUMN \`tier\` VARCHAR(50) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert tier column length back to 20
    // WARNING: This may truncate data if any tier values are longer than 20 characters
    await queryRunner.query(
      `ALTER TABLE \`subscriptions\` MODIFY COLUMN \`tier\` VARCHAR(20) NOT NULL`,
    );
  }
}
