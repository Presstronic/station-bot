import axios from 'axios';
import * as cheerio from 'cheerio';
import { getLogger } from '../utils/logger.js';
import { log } from 'console';

const logger = getLogger();

export async function scrapeAndCheckValueSpecific(
    url: string,
    parentSelector: string,
    childSelector: string,
    searchValue: string
): Promise<boolean> {
    try {
        logger.debug(`Scraping ${url} for ${searchValue}`);

        const { data } = await axios.get<string>(url);

        const $ = cheerio.load(data);
        const parentDiv = $(parentSelector);

        const value = parentDiv.find(childSelector).text();
        const exists = value.includes(searchValue);
        return exists;
    } catch (error) {
        console.error('Error fetching the page:', error);
        throw error;
    }
}
