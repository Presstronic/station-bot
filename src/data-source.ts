import { DataSource } from 'typeorm';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { AppUser } from './entity/app-user.entity.js';
import { Company } from './entity/company.entity.js'
import { Organization } from './entity/organization.entity.js';
import { Vehicle } from './entity/vehicle.entity.js';
import { VehicleType } from './entity/vehicle-type.entity.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: process.env.POSTGRES_STATION_USER,
  password: process.env.POSTGRES_STATION_PASSWORD,
  database: process.env.POSTGRES_STATION_DB,
  entities: [
    process.env.NODE_ENV === 'production'
      ? __dirname + '/entity/*.entity.js' // Use compiled files in production
      : __dirname + '/entity/*.entity.ts', // Use source files in development
  ],
  migrations: [
    process.env.NODE_ENV === 'production'
      ? __dirname + '/migrations/*.js'
      : __dirname + '/migrations/*.ts',
  ],
  synchronize: false, // Set to false in production
});
