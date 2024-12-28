import { Like, Repository } from 'typeorm';
import { Vehicle } from '../../entity/vehicle.entity';
import { Manufacturer } from '../../entity/presstronic/manufacturer.entity';
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class VehicleService {
  private vehicleRepository: Repository<Vehicle>;

  constructor() {
    this.vehicleRepository = AppDataSource.getRepository(Vehicle);
  }

  // Fetch a vehicle by ID
  public async getVehicleById(id: number): Promise<Vehicle | null> {
    return this.vehicleRepository.findOne({
      where: { id },
      relations: ['manufacturer'], // Include related manufacturer
    });
  }

  // Fetch a vehicle by name
  public async getVehicleByName(name: string): Promise<Vehicle | null> {
    return this.vehicleRepository.findOne({
      where: { name },
      relations: ['manufacturer'],
    });
  }

  // Fetch all vehicles
  public async getAllVehicles(): Promise<Vehicle[]> {
    return this.vehicleRepository.find({ relations: ['manufacturer'] });
  }

  // Fetch all vehicles by manufacturer
  public async getVehiclesByManufacturer(manufacturerId: number): Promise<Vehicle[]> {
    return this.vehicleRepository.find({
      where: { manufacturer: { id: manufacturerId } },
      relations: ['manufacturer'],
    });
  }

  // Create or update a vehicle
  public async saveVehicle(vehicleDetails: {
    uexCorpId: number;
    canHaveCustomName: boolean;
    manufacturer: Manufacturer;
    name: string;
    shortName?: string;
    cargoScuSize: number;
    crewSize: number;
    rsiStoreURL?: string;
    rsiBrochureUrl?: string;
    rsiVideoUrl?: string;
    padSize?: string;
    gameVersion?: string;
    uexCorpDateCreated: Date;
    uexCorpDateModified: Date;
  }): Promise<Vehicle> {
    const existingVehicle = await this.vehicleRepository.findOne({
      where: { uexCorpId: vehicleDetails.uexCorpId },
    });

    if (existingVehicle) {
      // Update existing vehicle
      Object.assign(existingVehicle, vehicleDetails);
      return this.vehicleRepository.save(existingVehicle);
    } else {
      // Create a new vehicle
      const newVehicle = this.vehicleRepository.create(vehicleDetails);
      return this.vehicleRepository.save(newVehicle);
    }
  }

  // Delete a vehicle by ID
  public async deleteVehicleById(id: number): Promise<boolean> {
    const deleteResult = await this.vehicleRepository.delete({ id });
    return (deleteResult.affected ?? 0) > 0;
  }

  // Search vehicles by name
  public async searchVehiclesByName(query: string): Promise<Vehicle[]> {
    return this.vehicleRepository.find({
      where: { name: Like(`%${query}%`) },
      order: { name: 'ASC' },
      relations: ['manufacturer'],
    });
  }
}

export default new VehicleService();
