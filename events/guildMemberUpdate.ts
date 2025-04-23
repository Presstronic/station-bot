// File: src/events/guildMemberUpdate.ts
import {
  Events,
  GuildMember,
  Role,
  TextChannel,
} from 'discord.js';
import { Event } from '../interfaces/Event';
import { getLogger } from '../utils/logger';
import i18n from '../utils/i18n-config';
import { config } from 'dotenv';

config();

const logger = getLogger();

const APPLICANT_ROLE_NAME = 'Applicant';
const VERIFIED_ROLE_NAME = 'Verified';
const ADMIN_LOG_CHANNEL_ID = process.env.VERIFY_ADMIN_LOG_CHANNEL_ID || '';

export const event: Event = {
  name: Events.GuildMemberUpdate,
  once: false,
  execute: async (oldMember: GuildMember, newMember: GuildMember) => {
    try {
      const guild = newMember.guild;

      const applicantRole = guild.roles.cache.find(
        (role: Role) => role.name === APPLICANT_ROLE_NAME
      );
      const verifiedRole = guild.roles.cache.find(
        (role: Role) => role.name === VERIFIED_ROLE_NAME
      );

      if (!applicantRole || !verifiedRole) {
        logger.warn(
          `Required role(s) not found in guild ${guild.name} (${guild.id})`
        );
        return;
      }

      const hadApplicantRole = oldMember.roles.cache.has(applicantRole.id);
      const hasApplicantRole = newMember.roles.cache.has(applicantRole.id);
      const hasVerifiedRole = newMember.roles.cache.has(verifiedRole.id);

      // Skip if user already had Applicant or is already Verified
      if (hadApplicantRole || hasVerifiedRole || !hasApplicantRole) return;

      // Send verification DM
      try {
        await newMember.send({
          content: i18n.__(
            'verify.prompt',
            { user: newMember.displayName }
          ),
        });

        logger.info(`Verification DM sent to ${newMember.user.tag}`);

        // Log to admin channel
        const channel = await guild.channels.fetch(ADMIN_LOG_CHANNEL_ID);
        if (channel?.isTextBased()) {
          await (channel as TextChannel).send({
            content: `📨 Sent verification DM to <@${newMember.id}>`,
          });
        } else {
          logger.warn(
            `Could not log DM sent for ${newMember.user.tag}: admin channel invalid.`
          );
        }
      } catch (dmError) {
        logger.warn(
          `Failed to DM ${newMember.user.tag} for verification. DMs may be disabled.`,
          dmError
        );
      }
    } catch (error) {
      logger.error('Unhandled error in guildMemberUpdate verification logic:', error);
    }
  },
};

// --------------------------------------------
// Optional future enhancement:
// Add separate file: `src/events/verifiedRoleAdded.ts`
// to listen for the Verified role being added
// and notify the admin log channel accordingly.

