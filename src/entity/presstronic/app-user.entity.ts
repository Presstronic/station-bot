import 'reflect-metadata';
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
} from 'typeorm';
import { Organization } from '../organization.entity'
  
@Entity('app_user')
export class AppUser {

  constructor(
    discordOAuthToken: string,
    rsiUsername: string,
    discordUsername: string,
    emailAddress: string,
    primaryOrganization: Organization
  ) {
    this.discordOAuthToken = discordOAuthToken;
    this.rsiUsername = rsiUsername;
    this.discordUsername = discordUsername;
    this.emailAddress = emailAddress;
    this.primaryOrganization = primaryOrganization;
  }    

  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', nullable: false })
  discordOAuthToken: string;

  @ManyToOne(() => Organization, (organization) => organization.appUsers)
  primaryOrganization: Organization;

  @Column({ type: 'varchar', length: 255, unique: true, nullable: false })
  rsiUsername: string;

  @Column({ type: 'varchar', length: 255 })
  discordUsername: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  firstname?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastname?: string;

  @Column({ type: 'varchar', unique: true, nullable: false })
  emailAddress: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  rsiVerificationCode?: string;

  @Column({ type: 'timestamp', nullable: true })
  rsiVerificationDate?: Date;

  @CreateDateColumn()
  dateCreated!: Date;

  @UpdateDateColumn()
  dateModified!: Date;
}
  