import { Repository } from 'typeorm';
import { Manufacturer } from '../../entity/presstronic/manufacturer.entity';
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class ManufacturerService {
  private manufacturerRepository: Repository<Manufacturer>;

  constructor() {
    this.manufacturerRepository = AppDataSource.getRepository(Manufacturer);
  }

  // Fetch a manufacturer by ID
  public async getManufacturerById(id: number): Promise<Manufacturer | null> {
    return this.manufacturerRepository.findOne({ where: { id } });
  }

  // Fetch all manufacturers
  public async getAllManufacturers(): Promise<Manufacturer[]> {
    return this.manufacturerRepository.find();
  }

  public async searchManufacturersByName(name: string): Promise<Manufacturer[]> {
    return this.manufacturerRepository.find({ where: { name: name } });
  }

  // Fetch manufacturers by type (e.g., isVehicleManufacturer or isItemManufacturer)
  public async getManufacturersByType(
    isVehicleManufacturer?: boolean,
    isItemManufacturer?: boolean
  ): Promise<Manufacturer[]> {
    const whereCondition: Partial<Manufacturer> = {};
    if (isVehicleManufacturer !== undefined) {
      whereCondition.isVehicleManufacturer = isVehicleManufacturer;
    }
    if (isItemManufacturer !== undefined) {
      whereCondition.isItemManufacturer = isItemManufacturer;
    }

    return this.manufacturerRepository.find({ where: whereCondition });
  }

  // Create or update a manufacturer
  public async saveManufacturer(manufacturerDetails: {
    name: string;
    nickname?: string;
    industry?: string;
    isItemManufacturer: boolean;
    isVehicleManufacturer: boolean;
    uexCorpDateCreated: Date;
    uexCorpDateModified: Date;
  }): Promise<Manufacturer> {
    const existingManufacturer = await this.manufacturerRepository.findOne({
      where: { name: manufacturerDetails.name },
    });

    if (existingManufacturer) {
      // Update existing manufacturer
      Object.assign(existingManufacturer, manufacturerDetails);
      return this.manufacturerRepository.save(existingManufacturer);
    } else {
      // Create new manufacturer
      const newManufacturer = this.manufacturerRepository.create(manufacturerDetails);
      return this.manufacturerRepository.save(newManufacturer);
    }
  }

  // Delete a manufacturer by ID
  public async deleteManufacturerById(id: number): Promise<boolean> {
    const deleteResult = await this.manufacturerRepository.delete({ id });
    return (deleteResult.affected ?? 0) > 0;
  }
}

export default new ManufacturerService();
