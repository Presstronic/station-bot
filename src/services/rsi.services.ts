import { getLogger } from '../utils/logger.js';
import { fetchHtml } from './web-scraping.services.js';
import { parseSelectorCheckInWorker, parseCanonicalHandleInWorker } from '../workers/html-parse.pool.js';
import { getUserVerificationData } from '../commands/verify.js';
import { getRsiConfig, buildCitizenUrl } from '../config/rsi.config.js';

const logger = getLogger();

/**
 * Verifies that the user's dreadnought validation code is present in their RSI bio
 * and returns the canonical handle casing from the RSI profile page.
 *
 * @param userId - Discord user ID; the RSI handle and validation code are retrieved
 *   via getUserVerificationData
 * @returns `{ verified, canonicalHandle }`:
 *   - `verified` is true when the validation code is found in the bio.
 *   - `canonicalHandle` is the `span.nick` value from the profile page, falling back
 *     to the typed input on fetch or parse failure.
 *   - If no verification session exists for the user, returns
 *     `{ verified: false, canonicalHandle: '' }`. Callers are expected to guard
 *     against the no-session case before invoking this function.
 */
export async function verifyRSIProfile(userId: string): Promise<{ verified: boolean; canonicalHandle: string }> {
    logger.debug(`Verifying RSI Profile for user ID: ${userId}`);

    const userData = getUserVerificationData(userId);
    if (!userData) {
        logger.debug(`No user data found for user ID: ${userId}`);
        return { verified: false, canonicalHandle: '' };
    }

    const rsiProfileName = userData.rsiProfileName.trim();
    let url: string | undefined;

    logger.debug(`Verifying RSI Profile: ${rsiProfileName}`);

    try {
        url = buildCitizenUrl(rsiProfileName);
        const { bioParentSelector, bioChildSelector } = getRsiConfig();

        logger.debug(`RSI Profile URL: ${url}`);

        const html = await fetchHtml(url);
        const [verified, canonicalHandle] = await Promise.all([
            parseSelectorCheckInWorker(html, bioParentSelector, bioChildSelector, userData.dreadnoughtValidationCode),
            parseCanonicalHandleInWorker(html, rsiProfileName),
        ]);
        logger.info('RSI profile verification completed', {
            userId,
            rsiHandle: rsiProfileName,
            outcome: verified ? 'passed' : 'failed',
        });
        return { verified, canonicalHandle };
    } catch (error) {
        logger.error('RSI profile verification error', { userId, rsiHandle: rsiProfileName, error, url });
        return { verified: false, canonicalHandle: rsiProfileName };
    }
}
