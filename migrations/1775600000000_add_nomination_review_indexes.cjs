exports.up = (pgm) => {
  // Hot path: unprocessed review queue without a status filter.
  pgm.sql(`
    CREATE INDEX idx_nominations_unprocessed_updated_at
      ON nominations (updated_at DESC)
      WHERE lifecycle_state != 'processed'
  `);

  pgm.sql(`
    CREATE INDEX idx_nominations_unprocessed_nomination_count_updated_at
      ON nominations (nomination_count DESC, updated_at DESC)
      WHERE lifecycle_state != 'processed'
  `);

  // Filtered path: specific lifecycle state with review sort variants.
  pgm.sql(`
    CREATE INDEX idx_nominations_lifecycle_state_updated_at
      ON nominations (lifecycle_state, updated_at DESC)
  `);

  pgm.sql(`
    CREATE INDEX idx_nominations_lifecycle_state_nomination_count_updated_at
      ON nominations (lifecycle_state, nomination_count DESC, updated_at DESC)
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX idx_nominations_lifecycle_state_nomination_count_updated_at');
  pgm.sql('DROP INDEX idx_nominations_lifecycle_state_updated_at');
  pgm.sql('DROP INDEX idx_nominations_unprocessed_nomination_count_updated_at');
  pgm.sql('DROP INDEX idx_nominations_unprocessed_updated_at');
};
