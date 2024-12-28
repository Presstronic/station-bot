import { logger } from '../../utils/logger';
import axios from 'axios';
import { scrapeAndCheckValueSpecific } from '../web-util/web-scraping.services';
import { getUserVerificationData } from '../../commands/verify';

/**
 * Although we do not actually have an RSI API as of yet, we will treat the service as
 * the API.
 * 
 * @param rsiProfileName
 * @returns 
 */
export async function verifyRSIProfile(userId: string): Promise<boolean>{
    try {

        const userData = getUserVerificationData(userId);

        if (!userData) {
            return false;
        }

        // TODO: Move most of this to web-scraping.services.ts
        const rsiProfile = userData.rsiProfileName;
        const rsiProfileName = rsiProfile.split('/').pop();
        const url = `https://robertsspaceindustries.com/citizens/${encodeURIComponent(rsiProfile)}`;
        const parentSelector = 'div.entry.bio';
        const childSelector = 'div.value';

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