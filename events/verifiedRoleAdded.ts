// File: src/events/verifiedRoleAdded.ts
import {
  Events,
  GuildMember,
  Role,
  TextChannel,
} from 'discord.js';
import { Event } from '../interfaces/Event';
import { getLogger } from '../utils/logger';
import { config } from 'dotenv';

config();

const logger = getLogger();

const VERIFIED_ROLE_NAME = 'Verified';
const ADMIN_LOG_CHANNEL_ID = process.env.VERIFY_ADMIN_LOG_CHANNEL_ID || '';

export const event: Event = {
  name: Events.GuildMemberUpdate,
  once: false,
  execute: async (oldMember: GuildMember, newMember: GuildMember) => {
    try {
      const guild = newMember.guild;

      const verifiedRole = guild.roles.cache.find(
        (role: Role) => role.name === VERIFIED_ROLE_NAME
      );

      if (!verifiedRole) {
        logger.warn(
          `Verified role not found in guild ${guild.name} (${guild.id})`
        );
        return;
      }

      const hadVerified = oldMember.roles.cache.has(verifiedRole.id);
      const nowVerified = newMember.roles.cache.has(verifiedRole.id);

      if (!hadVerified && nowVerified) {
        const adminChannel = await guild.channels.fetch(ADMIN_LOG_CHANNEL_ID);
        if (adminChannel?.isTextBased()) {
          await (adminChannel as TextChannel).send({
            content: `✅ <@${newMember.id}> has completed verification and has been given the Verified role.`,
          });
          logger.info(`Verification completion logged for ${newMember.user.tag}`);
        } else {
          logger.warn(
            `Could not log verification completion for ${newMember.user.tag}: admin channel invalid.`
          );
        }
      }
    } catch (error) {
      logger.error('Error during Verified role tracking:', error);
    }
  },
};

