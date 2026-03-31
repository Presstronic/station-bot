import { getLogger } from '../utils/logger.js';
import { scrapeAndCheckValueSpecific } from './web-scraping.services.js';
import { getUserVerificationData } from '../commands/verify.js';

const logger = getLogger();

/**
 * Although we do not actually have an RSI API as of yet, we will treat the service as
 * the API.
 *
 * @param userId - Discord user ID; the RSI handle is retrieved via getUserVerificationData
 * @returns true if the user's dreadnought validation code is found in their RSI bio
 */
export async function verifyRSIProfile(userId: string): Promise<boolean> {
    logger.debug(`Verifying RSI Profile for user ID: ${userId}`);
    try {

        const userData = getUserVerificationData(userId);
        if (!userData) {
            logger.debug(`No user data found for user ID: ${userId}`);
            return false;
        }

        // TODO: Move most of this to web-scraping.services.ts
        const rsiProfile = userData.rsiProfileName;
        const rsiProfileName = rsiProfile.split('/').filter((s) => s.length > 0).pop() || rsiProfile.trim();
        // TODO: Move this to a config file until I can setup database
        const url = `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(rsiProfileName)}`;
        const parentSelector = 'div.entry.bio';
        const childSelector = 'div.value';

        logger.debug(`Verifying RSI Profile: ${rsiProfileName}`);
        logger.debug(`RSI Profile URL: ${url}`);

        return await scrapeAndCheckValueSpecific(
            url,
            parentSelector,
            childSelector,
            userData.dreadnoughtValidationCode
        );

    } catch (error) {
        logger.error(`Error checking RSI profile: ${error}`);
        return false;
    }
}
