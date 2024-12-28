// src/uex-corp/dtos/company.dto.ts
export interface CompanyDTO {
    id: number;
    name: string;
    nickname?: string;
    industry?: string;
    isItemManufacturer: boolean;
    isVehicleManufacturer: boolean;
  
    // Date fields from UEXCorp
    dateCreated: string;
    dateModified: string;
  
    // ... any other fields returned by the UEXCorp company endpoint ...
  }
  