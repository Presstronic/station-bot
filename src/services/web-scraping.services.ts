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

        // Fetch the HTML content of the webpage
        const { data } = await axios.get<string>(url);

        // Load the HTML into cheerio
        const $ = cheerio.load(data);

        // Use the parentSelector to locate the parent div
        const parentDiv = $(parentSelector);

        // Use the childSelector to locate the child div within the parent div
        const value = parentDiv.find(childSelector).text();

        // Check if the specific value exists in the text content
        const exists = value.includes(searchValue);

        return exists;
    } catch (error) {
        console.error('Error fetching the page:', error);
        throw error;
    }
}
