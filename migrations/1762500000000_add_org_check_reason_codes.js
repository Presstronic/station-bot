/* eslint-disable camelcase */

exports.shorthands = undefined;

const orgCheckResultCodes = [
  'in_org',
  'not_in_org',
  'not_found',
  'http_timeout',
  'rate_limited',
  'parse_failed',
  'http_error',
];

exports.up = (pgm) => {
  pgm.addColumns('nominations', {
    last_org_check_result_code: { type: 'text' },
    last_org_check_result_message: { type: 'text' },
    last_org_check_result_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'nominations',
    'nominations_last_org_check_result_code_valid',
    `CHECK (
      last_org_check_result_code IS NULL
      OR last_org_check_result_code IN (${orgCheckResultCodes.map((code) => `'${code}'`).join(', ')})
    )`
  );

  pgm.addConstraint(
    'nominations',
    'nominations_org_check_status_code_consistent',
    `CHECK (
      (
        last_org_check_result_code IS NULL
        AND (last_org_check_status IS NULL OR last_org_check_status IN ('in_org', 'not_in_org', 'unknown'))
      )
      OR (last_org_check_result_code = 'in_org' AND last_org_check_status = 'in_org')
      OR (last_org_check_result_code = 'not_in_org' AND last_org_check_status = 'not_in_org')
      OR (
        last_org_check_result_code IN ('not_found', 'http_timeout', 'rate_limited', 'parse_failed', 'http_error')
        AND last_org_check_status = 'unknown'
      )
    )`
  );

  pgm.createIndex('nominations', ['last_org_check_result_code'], {
    name: 'idx_nominations_last_org_check_result_code',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('nominations', ['last_org_check_result_code'], {
    name: 'idx_nominations_last_org_check_result_code',
  });
  pgm.dropConstraint('nominations', 'nominations_org_check_status_code_consistent');
  pgm.dropConstraint('nominations', 'nominations_last_org_check_result_code_valid');
  pgm.dropColumns('nominations', [
    'last_org_check_result_code',
    'last_org_check_result_message',
    'last_org_check_result_at',
  ]);
};
