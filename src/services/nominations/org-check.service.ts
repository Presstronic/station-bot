import axios from 'axios';
import * as cheerio from 'cheerio';
import type { OrgCheckStatus } from './types.ts';

const defaultCitizenPattern = 'https://robertsspaceindustries.com/en/citizens/{handle}';

function buildCitizenUrl(handle: string): string {
  const pattern = process.env.RSI_CITIZEN_URL_PATTERN || defaultCitizenPattern;
  return pattern.replace('{handle}', encodeURIComponent(handle.trim()));
}

export async function checkHasAnyOrgMembership(rsiHandle: string): Promise<OrgCheckStatus> {
  const url = buildCitizenUrl(rsiHandle);
  const response = await axios.get<string>(url, {
    validateStatus: (status) => status < 500,
  });

  if (response.status !== 200 || !response.data) {
    return 'unknown';
  }

  const $ = cheerio.load(response.data);
  const orgLink = $('a[href*="/orgs/"]').first().text().trim();
  if (orgLink.length > 0) {
    return 'in_org';
  }

  const bodyText = $('body').text().toLowerCase();
  if (bodyText.includes('no affiliation')) {
    return 'not_in_org';
  }

  if (bodyText.includes('affiliation') && bodyText.includes('none')) {
    return 'not_in_org';
  }

  return 'unknown';
}
