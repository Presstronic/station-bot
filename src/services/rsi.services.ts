import { getLogger } from '../utils/logger.js';
import { fetchHtml } from './web-scraping.services.js';
import { parseSelectorCheckInWorker, parseCanonicalHandleInWorker } from '../workers/html-parse.pool.js';
import { getUserVerificationData } from '../commands/verify.js';

const logger = getLogger();

/**
 * Verifies that the user's dreadnought validation code is present in their RSI bio
 * and returns the canonical handle casing from the RSI profile page.
 *
 * @param userId - Discord user ID; the RSI handle and validation code are retrieved
 *   via getUserVerificationData
 * @returns `{ verified, canonicalHandle }` — verified is true when the code is found
 *   in the bio; canonicalHandle is the span.nick value from the profile page, falling
 *   back to the typed input if the element is absent or the fetch fails.
 */
export async function verifyRSIProfile(userId: string): Promise<{ verified: boolean; canonicalHandle: string }> {
    logger.debug(`Verifying RSI Profile for user ID: ${userId}`);

    const userData = getUserVerificationData(userId);
    if (!userData) {
        logger.debug(`No user data found for user ID: ${userId}`);
        return { verified: false, canonicalHandle: '' };
    }

    const rsiProfileName = userData.rsiProfileName.trim();
    const url = `https://robertsspaceindustries.com/en/citizens/${encodeURIComponent(rsiProfileName)}`;
    const parentSelector = 'div.entry.bio';
    const childSelector = 'div.value';

    logger.debug(`Verifying RSI Profile: ${rsiProfileName}`);
    logger.debug(`RSI Profile URL: ${url}`);

    try {
        const html = await fetchHtml(url);
        const [verified, canonicalHandle] = await Promise.all([
            parseSelectorCheckInWorker(html, parentSelector, childSelector, userData.dreadnoughtValidationCode),
            parseCanonicalHandleInWorker(html, rsiProfileName),
        ]);
        return { verified, canonicalHandle };
    } catch (error) {
        logger.error(`Error checking RSI profile: ${error}`);
        return { verified: false, canonicalHandle: rsiProfileName };
    }
}
