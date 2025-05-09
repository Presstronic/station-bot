import { getLogger } from '../utils/logger.ts';
import axios from 'axios';
import { scrapeAndCheckValueSpecific } from './web-scraping.services.ts';
import { getUserVerificationData } from '../commands/verify.ts';

const logger = getLogger();

/**
 * Although we do not actually have an RSI API as of yet, we will treat the service as
 * the API.
 * 
 * @param rsiProfileName
 * @returns 
 */
export async function verifyRSIProfile(userId: string): Promise<boolean>{
    logger.debug(`Verifying RSI Profile for user ID: ${userId}`);
    try {

        const userData = getUserVerificationData(userId);
        if (!userData) {
            logger.debug(`No user data found for user ID: ${userId}`);
            return false;
        }

        // TODO: Move most of this to web-scraping.services.ts
        const rsiProfile = userData.rsiProfileName;
        const rsiProfileName = rsiProfile.split('/').pop();
        // TODO: Move this to a config file until I can setup database
        const url = `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(rsiProfile)}`;
        const parentSelector = 'div.entry.bio';
        const childSelector = 'div.value';

        logger.debug(`Verifying RSI Profile: ${rsiProfileName}`);
        logger.debug(`RSI Profile URL: ${url}`);

        const response = await axios.head(url, {
            validateStatus: (status) => status < 500, // Accept status codes less than 500  
        });

        if(response.status === 200) {
            logger.debug(`RSI Profile ${rsiProfileName} exists.`);
        }
        else {
            logger.debug(`RSI Profile ${rsiProfileName} does not exist.`);
            return false;  
        }

        let validateStatusValueFound = await scrapeAndCheckValueSpecific(
            url,
            parentSelector,
            childSelector,
            userData.dreadnoughtValidationCode
        );

        return validateStatusValueFound;

    } catch (error) {
        logger.error(`Error checking RSI profile: ${error}`);
        return false;
    }
}
