import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { AppUser } from './app-user.entity';

@Entity('organization')
export class Organization {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', unique: true, nullable: false })
  uexCorpId: number;

  @Column({ type: 'varchar', unique: true, nullable: false })
  rsi_slug: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  rsiVerificationCode?: string;

  @Column({ type: 'timestamp', nullable: true })
  rsiVerificationDate?: Date;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  logo?: string;

  @CreateDateColumn()
  dateCreated!: Date;

  @UpdateDateColumn()
  dateModified!: Date;

  @OneToMany(() => AppUser, (appUser) => appUser.primaryOrganization)
  appUsers!: AppUser[];

  constructor(
    uexCorpId: number,
    rsi_slug: string,
    name: string
  ) {
    this.uexCorpId = uexCorpId;
    this.rsi_slug = rsi_slug;
    this.name = name;
  }
}