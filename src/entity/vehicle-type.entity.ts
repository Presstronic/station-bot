import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
  } from 'typeorm';
  
  @Entity('vehicle_type')
  export class VehicleType {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({ length: 100, nullable: false })
    name: string;
  
    @Column({ length: 255, nullable: true })
    friendlyName?: string;
  
    @CreateDateColumn()
    dateCreated: Date;
  
    @UpdateDateColumn()
    dateModified: Date;
  }
  