import { AppDataSource } from '../data-source';
import { Vehicle } from '../entity/vehicle.entity';

export const vehicleRepository = AppDataSource.getRepository(Vehicle);