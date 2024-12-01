import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeValueFromDiv(url: string, selector: string): Promise<string> {
    try {
        // Fetch the HTML content of the webpage
        const { data } = await axios.get<string>(url);

        // Load the HTML into cheerio
        const $ = cheerio.load(data);

        // Use the selector to find the div and extract its text content
        const value = $(selector).text().trim();

        return value;
    } catch (error) {
        console.error('Error fetching the page:', error);
        throw error;
    }
}
  