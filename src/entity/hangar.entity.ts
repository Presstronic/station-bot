import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AppUser } from './app-user.entity';
import { Vehicle } from './vehicle.entity';

@Entity('hangar')
export class Hangar {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => AppUser, (user: AppUser) => user.id, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: AppUser;

  @ManyToOne(() => Vehicle, (vehicle: Vehicle) => vehicle.id, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'vehicle_id' })
  vehicle!: Vehicle;

  @CreateDateColumn()
  dateAdded!: Date;

  @UpdateDateColumn()
  dateModified!: Date;

  constructor(user: AppUser, vehicle: Vehicle) {
    this.user = user;
    this.vehicle = vehicle;
  }
}
  