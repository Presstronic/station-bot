import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('manufacturer')
export class Manufacturer {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  name: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  industry?: string;

  @Column({ type: 'boolean', default: false })
  isItemManufacturer: boolean;

  @Column({ type: 'boolean', default: false })
  isVehicleManufacturer: boolean;

  @Column({ type: 'timestamp', nullable: false })
  uexCorpDateCreated: Date;

  @Column({ type: 'timestamp', nullable: false })
  uexCorpDateModified: Date;

  @CreateDateColumn()
  dateCreated!: Date;

  @UpdateDateColumn()
  dateModified!: Date;

  constructor(
    name: string,
    isItemManufacturer: boolean,
    isVehicleManufacturer: boolean,
    uexCorpDateCreated: Date,
    uexCorpDateModified: Date
  ) {
    this.name = name;
    this.isItemManufacturer = isItemManufacturer;
    this.isVehicleManufacturer = isVehicleManufacturer;
    this.uexCorpDateCreated = uexCorpDateCreated;
    this.uexCorpDateModified = uexCorpDateModified;
  }
}
