// src/uex-corp/client/uex-corp.client.ts
import axios from 'axios';
import { VehicleDTO } from '../../../entity/uexcorp/dto/vehicle.dto';
import { CompanyDTO } from '../../../entity/uexcorp/dto/company.dto';

const BASE_URL = 'https://uexcorp.space/api/2.0';

// Fetch an array of VehicleDTO
export async function fetchVehicles(): Promise<VehicleDTO[]> {
  const response = await axios.get<VehicleDTO[]>(`${BASE_URL}/vehicles`);
  return response.data;
}

// Fetch an array of CompanyDTO
export async function fetchCompanies(): Promise<CompanyDTO[]> {
  const { data } = await axios.get<CompanyDTO[]>(`${BASE_URL}/companies`);
  return data;
}
