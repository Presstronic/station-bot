import { DataSource } from 'typeorm';
import { Organization } from './entity/organization';
import { User } from './entity/User';
import { Vehicle } from './entity/Vehicle';
import { VehicleType } from './entity/VehicleType';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'your_username',
  password: 'your_password',
  database: 'your_database',
  entity: [Organization, User, Vehicle, VehicleType],
  migrations: ['./migrations/*.ts'],
  synchronize: false, // Set to false in production
});
