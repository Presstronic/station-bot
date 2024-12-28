import { AppDataSource } from '../data-source';
import { Manufacturer } from '../entity/presstronic/manufacturer.entity';

export const manufacturerRepository = AppDataSource.getRepository(Manufacturer);