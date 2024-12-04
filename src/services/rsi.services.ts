import { logger } from '../utils/logger';
import axios from 'axios';
import { scrapeAndCheckValueSpecific } from '../utils/scrapingTools';
import { getUserVerificationData } from '../commands/citizen';

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

        const rsiProfile = userData.rsiProfileName;
        const rsiProfileName = rsiProfile.split('/').pop();
        const url = `https://robertsspaceindustries.com/citizens/${encodeURIComponent(rsiProfile)}`;
        const parentSelector = 'div.entry.bio';
        const childSelector = 'div.value';

        // Make a HEAD request to check if the profile exists
        const response = await axios.head(url, {
            validateStatus: (status) => status < 500, // Accept status codes less than 500
        });

        if(response.status === 200) {
            logger.info(`RSI Profile ${rsiProfileName} exists.`);
        }
        else {
            logger.info(`RSI Profile ${rsiProfileName} does not exist.`);
            return false;  
        }

        const verificationCodeFound = await scrapeAndCheckValueSpecific(
            url,
            parentSelector,
            childSelector,
            userData.dreadnoughtValidationCode
        );

        return verificationCodeFound;
        
    } catch (error) {
        logger.error(`Error checking RSI profile: ${error}`);
        return false;
    }
}