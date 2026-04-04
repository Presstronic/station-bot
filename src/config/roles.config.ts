const DEFAULT_ROLE_NAMES = ['Verified', 'Temporary Member', 'Potential Applicant'] as const;

const PARSED_ROLES = (process.env.DEFAULT_ROLES ?? '')
  .split(',')
  .map((r) => r.trim())
  .filter((r) => r.length > 0);

const REQUIRED_ROLES: string[] = PARSED_ROLES.length > 0 ? PARSED_ROLES : [...DEFAULT_ROLE_NAMES];

export const VERIFIED_ROLE_NAME: string = REQUIRED_ROLES[0] ?? DEFAULT_ROLE_NAMES[0];
export const TEMP_MEMBER_ROLE_NAME: string = REQUIRED_ROLES[1] ?? DEFAULT_ROLE_NAMES[1];
export const POTENTIAL_APPLICANT_ROLE_NAME: string = REQUIRED_ROLES[2] ?? DEFAULT_ROLE_NAMES[2];

export { DEFAULT_ROLE_NAMES, REQUIRED_ROLES };
