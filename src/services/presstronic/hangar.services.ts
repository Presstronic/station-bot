import { Repository } from 'typeorm';
import { AppUser } from '../../entity/presstronic/app-user.entity';
import { Vehicle } from '../../entity/vehicle.entity';
import { Hangar } from '../../entity/hangar.entity';
import { AppDataSource } from '../../data-source'; // Replace with your actual data source path

class HangarService {
  private hangarRepository: Repository<Hangar>;

  constructor() {
    this.hangarRepository = AppDataSource.getRepository(Hangar);
  }

  // Add a vehicle to the user's hangar
  public async addVehicleToHangar(user: AppUser, vehicle: Vehicle): Promise<void> {
    const existingRecord = await this.hangarRepository.findOne({
      where: { user: { id: user.id }, vehicle: { id: vehicle.id } },
    });

    if (existingRecord) {
      throw new Error(`The vehicle "${vehicle.name}" is already in the user's hangar.`);
    }

    const hangar = new Hangar(user, vehicle);
    await this.hangarRepository.save(hangar);
  }

  // Remove a vehicle from the user's hangar
  public async removeVehicleFromHangar(user: AppUser, vehicle: Vehicle): Promise<boolean> {
    const deleteResult = await this.hangarRepository.delete({
      user: { id: user.id },
      vehicle: { id: vehicle.id },
    });

    return (deleteResult.affected ?? 0) > 0;
  }

  // Get all vehicles in the user's hangar
  public async getVehiclesInHangar(user: AppUser): Promise<Vehicle[]> {
    const hangarRecords = await this.hangarRepository.find({
      where: { user: { id: user.id } },
      relations: ['vehicle'],
    });

    return hangarRecords.map((record) => record.vehicle);
  }

  // Clear all vehicles from the user's hangar
  public async clearHangar(user: AppUser): Promise<void> {
    await this.hangarRepository.delete({ user: { id: user.id } });
  }
}

export default new HangarService();
