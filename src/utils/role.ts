import { ButtonInteraction } from "discord.js";
import { logger } from '../utils/logger';

export async function assignVerifiedRole(
    interaction: ButtonInteraction,
    userId: string
): Promise<boolean> {
    const guild = interaction.guild
    if (!guild) {
        logger.error('Guild not found in interaction.');
        return false;
    }

    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId));
    if (!member) {
        logger.error('Discord member not found in organization.');
        return false;
    }

    const verifiedRole = guild.roles.cache.find((role) => role.name === 'Verified');
    if (!verifiedRole) {
        logger.error('"Verified" role not found.');
        return false;
    }

    try {
        await member.roles.add(verifiedRole);
        logger.info(`Assigned "Verified" role to user ${member.user.tag}`);
        return true;
    } catch (error) {
        logger.error(`Error assigning role: ${error}`);
        return false;
    }
}

export async function removeVerifiedRole(
    interaction: ButtonInteraction,
    userId: string
): Promise<boolean> {
    const guild = interaction.guild;
    if (!guild) {
        logger.error('Guild not found in interaction.');
        return false;
    }

    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId));
    if (!member) {
        logger.error('Discord member not found in organization.');
        return false;
    }

    const verifiedRole = guild.roles.cache.find((role) => role.name === 'Verified');
    if (!verifiedRole) {
        logger.error('"Verified" role not found.');
        return false;
    }

    try {
        await member.roles.remove(verifiedRole);
        logger.info(`Removed "Verified" role from discord user ${member.user.tag}`);
        return true;
    } catch (error) {
        logger.error(`Error removing role: ${error}`);
        return false;
    }
}

