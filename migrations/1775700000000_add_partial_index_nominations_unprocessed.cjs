exports.noTransaction = true;

exports.up = (pgm) => {
  // 1775600000000 already added the equivalent partial index as
  // idx_nominations_unprocessed_updated_at. Keep this migration as a
  // compatibility cleanup step so unapplied environments do not create a
  // redundant duplicate index under the older name.
  pgm.dropIndex('nominations', [{ name: 'updated_at', sort: 'DESC' }], {
    concurrently: true,
    ifExists: true,
    name: 'idx_nominations_unprocessed',
  });
};

exports.down = (pgm) => {
  // No-op: the canonical index is managed by 1775600000000.
};
