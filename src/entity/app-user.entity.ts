import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
  } from 'typeorm';
  import { Organization } from './organization.entity.js'
  
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
  
    @Column({ nullable: false })
    discordOAuthToken: string;
  
    @ManyToOne(() => Organization, (organization) => organization.appUsers)
    primaryOrganization: Organization;
  
    @Column({ length: 255, unique: true, nullable: false })
    rsiUsername: string;
  
    @Column({ length: 255 })
    discordUsername: string;
  
    @Column({ length: 255, nullable: true })
    firstname?: string;
  
    @Column({ length: 255, nullable: true })
    lastname?: string;
  
    @Column({ unique: true, nullable: false })
    emailAddress: string;
  
    @Column({ length: 100, nullable: true })
    rsiVerificationCode?: string;
  
    @Column({ type: 'timestamp', nullable: true })
    rsiVerificationDate?: Date;
  
    @CreateDateColumn()
    dateCreated!: Date;
  
    @UpdateDateColumn()
    dateModified!: Date;
  }
  