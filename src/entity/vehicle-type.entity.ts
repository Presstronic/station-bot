import 'reflect-metadata';
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
  id!: number;

  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  friendlyName?: string;

  @CreateDateColumn()
  dateCreated!: Date;

  @UpdateDateColumn()
  dateModified!: Date;

  constructor(name: string) {
    this.name = name;
  }
}