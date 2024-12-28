// jobs/syncDataJob.ts
import { euxCorpService } from '../services/uexcorp/uexcorp.services'
import { saveManufacturers } from '../db/manufacturer.repository';
import { saveVehicleTypes } from '../db/vehicle-type.repository';
import { saveVehicles } from '../db/vehicle.repository';
/**
 * Fetch data from the EuxCorp API and store/update
 * it in your local database tables.
 */
export async function syncDataJob(): Promise<void> {
  try {
    console.log('[syncDataJob] Starting sync job...');

    // Fetch everything in parallel
    const [vehicles, manufacturers] = await Promise.all([
      euxCorpService.getVehicles(),
      euxCorpService.getManufacturers(),
    ]);

    // Upsert / Insert / Update each table
    await saveVehicles(vehicles);
    await saveManufacturers(manufacturers);

    console.log('[syncDataJob] Completed successfully.');
  } catch (error) {
    console.error('[syncDataJob] Error:', error);
  }
}
