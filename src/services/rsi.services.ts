import { logger } from '../utils/logger';
import axios from 'axios';

/**
 * Although we do not actually have an RSI API as of yet, we will treat the service as
 * the API.
 * 
 * @param rsiProfileName
 * @returns 
 */
export async function verifyRSIProfile(rsiProfileName: string): Promise<boolean>{
    try {
        const url = `https://robertsspaceindustries.com/citizens/${encodeURIComponent(rsiProfileName)}`;

        logger.info(`PROFILE URL:${url}`);

        // Make a HEAD request to check if the profile exists
        const response = await axios.head(url, {
            validateStatus: (status) => status < 500, // Accept status codes less than 500
        });

        if(response.status === 200) {
            logger.info(`RSI Profile ${rsiProfileName} exists.`);
            return true;
        }
        else {
            logger.info(`RSI Profile ${rsiProfileName} does not exist.`);
            return false;  
            // return response.status === 200;
        }
    } catch (error) {
        logger.error(`Error checking RSI profile: ${error}`);
        return false;
    }
}