import {
    Client,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
  } from 'discord.js';
  import { REST } from '@discordjs/rest';
  import { Routes } from 'discord-api-types/v10';
  import { AutocompleteInteraction } from 'discord.js';
  import VehicleService from '../services/presstronic/vehicle.services';
  import ManufacturerService from '../services/presstronic/manufacturer.services';
  import VehicleTypeService from '../services/presstronic/vehicle-type.services';

  import { logger } from '../utils/logger';
  
  export const hangarCommands = [
    new SlashCommandBuilder()
      .setName('hangar')
      .setDescription('Manage your hangar')
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add a ship to your hangar')
          .addStringOption(option =>
            option
              .setName('ship')
              .setDescription('The name of the ship to add')
              .setAutocomplete(true) // Enable autocomplete
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove a ship from your hangar')
          .addStringOption(option =>
            option
              .setName('ship')
              .setDescription('The name of the ship to remove')
              .setAutocomplete(true) // Enable autocomplete
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all ships in your hangar')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('clear')
          .setDescription('Remove all ships from your hangar')
      ),
  ];
    
  export const handleAutocomplete = async (interaction: AutocompleteInteraction) => {
    if (!interaction.isAutocomplete()) return;
  
    const focusedOption = interaction.options.getFocused(true);
  
    try {
      if (focusedOption.name === 'ship') {
        const input = focusedOption.value.toLowerCase(); // User's input
        if (input.length < 3) {
          // Debounce at 3 characters
          await interaction.respond([]);
          return;
        }
  
        // Search for vehicles by name using VehicleService
        const vehicles = await VehicleService.searchVehiclesByName(input);
  
        // Respond with up to 25 matching results (Discord's max limit)
        const results = vehicles.slice(0, 25).map(vehicle => ({
          name: `${vehicle.name} (${vehicle.manufacturer?.name ?? 'Unknown Manufacturer'})`,
          value: vehicle.id.toString(), // Use the ID as the value for easier handling in the command
        }));
  
        await interaction.respond(results);
      } else if (focusedOption.name === 'manufacturer') {
        const input = focusedOption.value.toLowerCase();
        if (input.length < 3) {
          // Debounce at 3 characters
          await interaction.respond([]);
          return;
        }
  
        // Search for manufacturers by name
        const manufacturers = await ManufacturerService.searchManufacturersByName(input);
  
        // Respond with up to 25 matching results
        const results = manufacturers.slice(0, 25).map(manufacturer => ({
          name: manufacturer.name,
          value: manufacturer.id.toString(), // Use the ID for easier handling
        }));
  
        await interaction.respond(results);
      } else if (focusedOption.name === 'type') {
        const input = focusedOption.value.toLowerCase();
        if (input.length < 2) {
          // Debounce at 2 characters for vehicle types
          await interaction.respond([]);
          return;
        }
  
        // Search for vehicle types by name
        const vehicleTypes = await VehicleTypeService.searchVehicleTypesByName(input);
  
        // Respond with up to 25 matching results
        const results = vehicleTypes.slice(0, 25).map(vehicleType => ({
          name: vehicleType.friendlyName ?? vehicleType.name,
          value: vehicleType.id.toString(), // Use the ID for easier handling
        }));
  
        await interaction.respond(results);
      }
    } catch (error) {
      console.error('Error handling autocomplete interaction:', error);
      await interaction.respond([]);
    }
  };
  