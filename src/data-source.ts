import { DataSource } from 'typeorm';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import { AppUser } from './entity/app-user.entity';
import { Company } from './entity/company.entity'
import { Organization } from './entity/organization.entity';
import { Vehicle } from './entity/vehicle.entity';
import { VehicleType } from './entity/vehicle-type.entity';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'station_app_user',
  password: 's9!45DSgh!~jdf9.aFFsdjf3&*f',
  database: 'station_db',
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
