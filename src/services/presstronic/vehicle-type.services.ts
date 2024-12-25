import { Repository } from 'typeorm';
import { VehicleType } from '../../entity/vehicle-type.entity';
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class VehicleTypeService {
  private vehicleTypeRepository: Repository<VehicleType>;

  constructor() {
    this.vehicleTypeRepository = AppDataSource.getRepository(VehicleType);
  }

  // Fetch a vehicle type by ID
  public async getVehicleTypeById(id: number): Promise<VehicleType | null> {
    return this.vehicleTypeRepository.findOne({ where: { id } });
  }

  // Fetch a vehicle type by name
  public async getVehicleTypeByName(name: string): Promise<VehicleType | null> {
    return this.vehicleTypeRepository.findOne({ where: { name } });
  }

  public async searchVehicleTypesByName(name: string): Promise<VehicleType[]> {
    return this.vehicleTypeRepository.find({ where: { name: name } });
  }

  // Fetch all vehicle types
  public async getAllVehicleTypes(): Promise<VehicleType[]> {
    return this.vehicleTypeRepository.find();
  }

  // Create or update a vehicle type
  public async saveVehicleType(vehicleTypeDetails: {
    name: string;
    friendlyName?: string;
  }): Promise<VehicleType> {
    const existingVehicleType = await this.vehicleTypeRepository.findOne({
      where: { name: vehicleTypeDetails.name },
    });

    if (existingVehicleType) {
      // Update existing vehicle type
      Object.assign(existingVehicleType, vehicleTypeDetails);
      return this.vehicleTypeRepository.save(existingVehicleType);
    } else {
      // Create a new vehicle type
      const newVehicleType = this.vehicleTypeRepository.create(vehicleTypeDetails);
      return this.vehicleTypeRepository.save(newVehicleType);
    }
  }

  // Delete a vehicle type by ID
  public async deleteVehicleTypeById(id: number): Promise<boolean> {
    const deleteResult = await this.vehicleTypeRepository.delete({ id });
    return (deleteResult.affected ?? 0) > 0;
  }
}

export default new VehicleTypeService();
