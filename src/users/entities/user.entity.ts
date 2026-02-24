import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserMode } from '../enums/user-mode.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 254 })
  email!: string;

  @Exclude()
  @Column({ length: 255 })
  passwordHash!: string;

  @Column({ unique: true, length: 30 })
  displayName!: string;

  @Exclude()
  @Column({ default: false })
  isActivated!: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 128 })
  activationToken!: string | null;

  @Column({ type: 'enum', enum: UserMode, default: UserMode.PRIVATE })
  mode!: UserMode;

  @Column({ default: true })
  appearInSearches!: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 128 })
  socketId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
