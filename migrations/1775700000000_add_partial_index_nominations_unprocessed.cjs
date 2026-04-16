exports.noTransaction = true;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nominations_unprocessed
      ON nominations (updated_at DESC)
      WHERE lifecycle_state != 'processed'
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX CONCURRENTLY IF EXISTS idx_nominations_unprocessed');
};
