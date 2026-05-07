import { getLogger } from '../utils/logger.js';
import { fetchHtml } from './web-scraping.services.js';
import { parseSelectorCheckInWorker, parseCanonicalHandleInWorker } from '../workers/html-parse.pool.js';
import { getUserVerificationData } from '../commands/verify.command.js';
import { getRsiConfig, buildCitizenUrl } from '../config/rsi.config.js';

const logger = getLogger();

/**
 * Verifies that the user's dreadnought validation code is present in their RSI bio
 * and returns the canonical handle casing from the RSI profile page.
 *
 * @param userId - Discord user ID; the RSI handle and validation code are retrieved
 *   via getUserVerificationData
 * @returns `{ verified, canonicalHandle, canonicalHandleScraped }`:
 *   - `verified` is true when the validation code is found in the bio.
 *   - `canonicalHandle` is the `span.nick` value from the profile page; falls back to
 *     the typed input when scraping fails or the element is absent.
 *   - `canonicalHandleScraped` is true only when `canonicalHandle` came from `span.nick`.
 *     Callers that require authoritative casing (e.g. setting a Discord nickname) must
 *     check this flag before acting; presenting `canonicalHandle` in informational messages
 *     when false is acceptable.
 *   - If no verification session exists for the user, returns
 *     `{ verified: false, canonicalHandle: '', canonicalHandleScraped: false }`. Callers
 *     are expected to guard against the no-session case before invoking this function.
 */
export async function verifyRSIProfile(userId: string): Promise<{ verified: boolean; canonicalHandle: string; canonicalHandleScraped: boolean }> {
    logger.debug(`Verifying RSI Profile for user ID: ${userId}`);

    const userData = getUserVerificationData(userId);
    if (!userData) {
        logger.debug(`No user data found for user ID: ${userId}`);
        return { verified: false, canonicalHandle: '', canonicalHandleScraped: false };
    }

    const rsiProfileName = userData.rsiProfileName.trim();
    let url: string | undefined = undefined;

    logger.debug(`Verifying RSI Profile: ${rsiProfileName}`);

    try {
        url = buildCitizenUrl(rsiProfileName);
        const { bioParentSelector, bioChildSelector } = getRsiConfig();

        logger.debug(`RSI Profile URL: ${url}`);

        const html = await fetchHtml(url);
        const [verified, scrapedHandle] = await Promise.all([
            parseSelectorCheckInWorker(html, bioParentSelector, bioChildSelector, userData.dreadnoughtValidationCode),
            parseCanonicalHandleInWorker(html),
        ]);
        if (scrapedHandle === null) {
            logger.warn('RSI profile canonical handle not found in page — span.nick absent or empty; falling back to typed input', {
                userId,
                rsiHandle: rsiProfileName,
            });
        }
        logger.info('RSI profile verification completed', {
            userId,
            rsiHandle: rsiProfileName,
            outcome: verified ? 'passed' : 'failed',
        });
        return { verified, canonicalHandle: scrapedHandle ?? rsiProfileName, canonicalHandleScraped: scrapedHandle !== null };
    } catch (error) {
        logger.error('RSI profile verification error', { userId, rsiHandle: rsiProfileName, error, url });
        return { verified: false, canonicalHandle: rsiProfileName, canonicalHandleScraped: false };
    }
}
