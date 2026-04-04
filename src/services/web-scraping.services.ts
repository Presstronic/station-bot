import axios from 'axios';
import { getLogger } from '../utils/logger.js';
import { parseSelectorCheckInWorker } from '../workers/html-parse.pool.js';

const logger = getLogger();

export async function fetchHtml(url: string): Promise<string> {
    const { data } = await axios.get<string>(url);
    return data;
}

export async function scrapeAndCheckValueSpecific(
    url: string,
    parentSelector: string,
    childSelector: string,
    searchValue: string
): Promise<boolean> {
    try {
        logger.debug(`Scraping ${url} for ${searchValue}`);

        const data = await fetchHtml(url);

        return await parseSelectorCheckInWorker(data, parentSelector, childSelector, searchValue);
    } catch (error) {
        logger.error('Error fetching the page', { error, url, parentSelector, childSelector, searchValue });
        throw error;
    }
}
