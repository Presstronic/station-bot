const lifecycleStates = ['new', 'checked', 'qualified', 'disqualified_in_org', 'processed'];

exports.up = (pgm) => {
  // 1. Add column nullable first (so backfill can run before NOT NULL)
  pgm.addColumns('nominations', {
    lifecycle_state: { type: 'text' },
  });

  // 2. Backfill from existing columns
  pgm.sql(`
    UPDATE nominations
    SET lifecycle_state = CASE
      WHEN is_processed = TRUE THEN 'processed'
      WHEN last_org_check_result_code = 'in_org' THEN 'disqualified_in_org'
      WHEN last_org_check_result_code = 'not_in_org' THEN 'qualified'
      WHEN last_org_check_at IS NOT NULL THEN 'checked'
      ELSE 'new'
    END
  `);

  // 3. Enforce NOT NULL + CHECK constraint
  pgm.alterColumn('nominations', 'lifecycle_state', { notNull: true });
  pgm.addConstraint(
    'nominations',
    'nominations_lifecycle_state_valid',
    `CHECK (lifecycle_state IN (${lifecycleStates.map((s) => `'${s}'`).join(', ')}))`
  );

  // 4. Index for common filter (non-processed list)
  pgm.createIndex('nominations', ['lifecycle_state'], {
    name: 'idx_nominations_lifecycle_state',
  });

  // 5. Drop is_processed (now redundant)
  pgm.dropColumns('nominations', ['is_processed']);
};

exports.down = (pgm) => {
  pgm.addColumns('nominations', {
    is_processed: { type: 'boolean', notNull: true, default: false },
  });
  pgm.sql(`
    UPDATE nominations
    SET is_processed = (lifecycle_state = 'processed')
  `);
  pgm.dropIndex('nominations', ['lifecycle_state'], { name: 'idx_nominations_lifecycle_state' });
  pgm.dropConstraint('nominations', 'nominations_lifecycle_state_valid');
  pgm.dropColumns('nominations', ['lifecycle_state']);
};
