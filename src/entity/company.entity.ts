import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
  } from 'typeorm';
  
  @Entity('company')
  export class Company {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ length: 255, nullable: false })
    name: string;
  
    @Column({ length: 100, nullable: true })
    nickname?: string;
  
    @Column({ length: 255, nullable: true })
    industry?: string;
  
    @Column({ default: false })
    isItemManufacturer: boolean;
  
    @Column({ default: false })
    isVehicleManufacturer: boolean;
  
    @Column({ type: 'timestamp', nullable: false })
    uexCorpDateCreated: Date;
  
    @Column({ type: 'timestamp', nullable: false })
    uexCorpDateModified: Date;
  
    @CreateDateColumn()
    dateCreated: Date;
  
    @UpdateDateColumn()
    dateModified: Date;
  }
  