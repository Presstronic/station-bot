// EuxCorpService.ts
import axios from 'axios';

export class EuxCorpService {
  private readonly baseUrl = 'https://euxcorp.space/api';

  /**
   * Get vehicles from EuxCorp.
   */
  public async getVehicles(): Promise<any> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/vehicles`);
      return data; 
    } catch (error: any) {
      console.error('Error fetching vehicles:', error.message);
      throw error; 
    }
  }

  /**
   * Get vehicle types from EuxCorp.
   */
  public async getVehicleTypes(): Promise<any> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/vehicle-types`);
      return data; 
    } catch (error: any) {
      console.error('Error fetching vehicle types:', error.message);
      throw error;
    }
  }

  /**
   * Get manufacturers from EuxCorp.
   */
  public async getManufacturers(): Promise<any> {
    try {
      const { data } = await axios.get(`${this.baseUrl}/manufacturers`);
      return data; 
    } catch (error: any) {
      console.error('Error fetching manufacturers:', error.message);
      throw error;
    }
  }
}

// Export a singleton instance of the service (optional, but common):
export const euxCorpService = new EuxCorpService();
