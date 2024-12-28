// src/uex-corp/dtos/vehicle.dto.ts
export interface VehicleDTO {
    id: number;
    name: string;
    shortName?: string;
    canHaveCustomName: boolean;
    cargoScu?: number;
    crew?: number;
    padSize?: string;
    rsiStoreUrl?: string;
    rsiBrochureUrl?: string;
    rsiVideoUrl?: string;
  
    // The UEXCorp API date fields
    dateCreated: string;
    dateModified: string;
  
    // Possibly references the manufacturer (company)
    manufacturerId?: number;
  
    // ... any other fields returned by the UEXCorp vehicle endpoint ...
  }
  