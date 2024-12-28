// src/uex-corp/sync/sync-uex-corp.ts
import { fetchVehicles, fetchCompanies } from '../../../services/uexcorp/client/uex-corp.client';
import { VehicleDTO } from '../../../entity/uexcorp/dto/vehicle.dto';
import { CompanyDTO } from '../../../entity/uexcorp/dto/company.dto';

import { Vehicle } from '../../../entity/presstronic/vehicle.entity';
import { Manufacturer } from '../../../entity/presstronic/manufacturer.entity';

import { vehicleRepository } from '../../../db/vehicle.repository';
import { manufacturerRepository } from '../../../db/manufacturer.repository';

/**
 * Main function to sync both Vehicles and Companies from UEXCorp.
 * Call this on startup and/or on a scheduled basis.
 */
export async function syncUexCorpData(): Promise<void> {
  try {
    console.log('[syncUexCorpData] Starting sync...');

    // 1) Fetch from UEXCorp (in parallel)
    const [remoteVehicles, remoteCompanies] = await Promise.all([
      fetchVehicles(),
      fetchCompanies(),
    ]);

    // 2) Get local data
    //    If you have a column for "uexCorpId" in Manufacturer, you'll want to fetch them all
    const localVehicles = await vehicleRepository.find();
    const localManufacturers = await manufacturerRepository.find();

    // 3) Sync manufacturers first (because vehicles reference them)
    await syncManufacturers(remoteCompanies, localManufacturers);

    // 4) Sync vehicles
    await syncVehicles(remoteVehicles, localVehicles);

    console.log('[syncUexCorpData] Sync completed successfully.');
  } catch (error) {
    console.error('[syncUexCorpData] Error:', error);
  }
}

/**
 * Sync manufacturers (UEXCorp calls them "companies").
 *  - Insert if no local record
 *  - Update only if remote `dateModified` is newer
 *  - Mark local as isDeleted if not found in new data
 */
async function syncManufacturers(remoteCompanies: CompanyDTO[], localManufacturers: Manufacturer[]) {
  // Map local by their UEXCorp ID. 
  // NOTE: Make sure your Manufacturer entity has a 'uexCorpId' column if you want to match by ID
  const localByUexId = new Map<number, Manufacturer>();
  for (const m of localManufacturers) {
    // If you haven't added a 'uexCorpId' field, do so or pick a unique property
    // For example: localByUexId.set(m.uexCorpId, m);
    // For now, let's assume you added `uexCorpId: number` in Manufacturer
    localByUexId.set((m as any).uexCorpId, m);
  }

  const seenIds = new Set<number>();

  for (const remote of remoteCompanies) {
    const remoteId = remote.id;
    const local = localByUexId.get(remoteId);

    const remoteDateCreated = new Date(remote.dateCreated);
    const remoteDateModified = new Date(remote.dateModified);

    if (!local) {
      // Insert a new manufacturer
      const newManufacturer = manufacturerRepository.create({
        // Add a `uexCorpId` column to your Manufacturer entity to store this ID
        // e.g.: uexCorpId: remoteId,
        name: remote.name,
        nickname: remote.nickname,
        industry: remote.industry,
        isItemManufacturer: remote.isItemManufacturer,
        isVehicleManufacturer: remote.isVehicleManufacturer,
        uexCorpDateCreated: remoteDateCreated,
        uexCorpDateModified: remoteDateModified,
        isDeleted: false,
      });
      await manufacturerRepository.save(newManufacturer);
    } else {
      // Compare remote's dateModified to local.uexCorpDateModified
      if (remoteDateModified > local.uexCorpDateModified) {
        // Update existing
        local.name = remote.name;
        local.nickname = remote.nickname;
        local.industry = remote.industry;
        local.isItemManufacturer = remote.isItemManufacturer;
        local.isVehicleManufacturer = remote.isVehicleManufacturer;
        local.uexCorpDateModified = remoteDateModified;

        // Un-delete if previously deleted
        if (local.isDeleted) {
          local.isDeleted = false;
        }

        await manufacturerRepository.save(local);
      } else {
        // If remote date is not newer, ensure not deleted
        if (local.isDeleted) {
          local.isDeleted = false;
          await manufacturerRepository.save(local);
        }
      }
    }

    seenIds.add(remoteId);
  }

  // Mark local records not in the new data as deleted
  for (const local of localManufacturers) {
    const localUexId = (local as any).uexCorpId;
    if (!seenIds.has(localUexId) && !local.isDeleted) {
      local.isDeleted = true;
      await manufacturerRepository.save(local);
    }
  }
}

/**
 * Sync vehicles:
 *  - Insert if no local record
 *  - Update if remote `dateModified` is newer
 *  - Mark as deleted if not found in new data
 */
async function syncVehicles(remoteVehicles: VehicleDTO[], localVehicles: Vehicle[]) {
  // Map local by UEXCorp ID
  const localByUexId = new Map<number, Vehicle>();
  for (const v of localVehicles) {
    localByUexId.set(v.uexCorpId, v);
  }

  const seenIds = new Set<number>();

  for (const remote of remoteVehicles) {
    const remoteId = remote.id;
    const local = localByUexId.get(remoteId);

    const remoteDateCreated = new Date(remote.dateCreated);
    const remoteDateModified = new Date(remote.dateModified);

    if (!local) {
      // We need to find the local manufacturer for remote.manufacturerId
      let manufacturer: Manufacturer | null = null;
      if (remote.manufacturerId) {
        manufacturer = await manufacturerRepository.findOne({
          where: { 
            // If you have "uexCorpId" in manufacturer
            // e.g. uexCorpId: remote.manufacturerId
            ['uexCorpId']: remote.manufacturerId,
          },
        }) || null;
      }

      const newVehicle = vehicleRepository.create({
        uexCorpId: remoteId,
        name: remote.name,
        shortName: remote.shortName,
        canHaveCustomName: remote.canHaveCustomName,
        cargoScuSize: remote.cargoScu ?? 0,
        crewSize: remote.crew ?? 0,
        rsiStoreURL: remote.rsiStoreUrl,
        rsiBrochureUrl: remote.rsiBrochureUrl,
        rsiVideoUrl: remote.rsiVideoUrl,
        padSize: remote.padSize,
        uexCorpDateCreated: remoteDateCreated,
        uexCorpDateModified: remoteDateModified,
        isDeleted: false,

        // manufacturer relationship
        manufacturer,
      });

      await vehicleRepository.save(newVehicle);
    } else {
      // Compare remote's dateModified to local.uexCorpDateModified
      if (remoteDateModified > local.uexCorpDateModified) {
        local.name = remote.name;
        local.shortName = remote.shortName;
        local.canHaveCustomName = remote.canHaveCustomName;
        local.cargoScuSize = remote.cargoScu ?? 0;
        local.crewSize = remote.crew ?? 0;
        local.rsiStoreURL = remote.rsiStoreUrl ?? null;
        local.rsiBrochureUrl = remote.rsiBrochureUrl ?? null;
        local.rsiVideoUrl = remote.rsiVideoUrl ?? null;
        local.padSize = remote.padSize ?? null;
        local.uexCorpDateModified = remoteDateModified;

        // Update manufacturer if changed
        if (remote.manufacturerId) {
          const newManufacturer = await manufacturerRepository.findOne({
            where: { ['uexCorpId']: remote.manufacturerId },
          });
          local.manufacturer = newManufacturer || null;
        }

        // Un-delete if previously marked
        if (local.isDeleted) {
          local.isDeleted = false;
        }

        await vehicleRepository.save(local);
      } else {
        // If remote date isn't newer, just ensure local isn't flagged as deleted
        if (local.isDeleted) {
          local.isDeleted = false;
          await vehicleRepository.save(local);
        }
      }
    }

    seenIds.add(remoteId);
  }

  // Mark local vehicles as deleted if not present in remote
  for (const local of localVehicles) {
    if (!seenIds.has(local.uexCorpId) && !local.isDeleted) {
      local.isDeleted = true;
      await vehicleRepository.save(local);
    }
  }
}
