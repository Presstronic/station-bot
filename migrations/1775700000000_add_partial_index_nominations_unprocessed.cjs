exports.noTransaction = true;

exports.up = (pgm) => {
  // 1775600000000 already added the equivalent partial index as
  // idx_nominations_unprocessed_updated_at. Keep this migration as a
  // compatibility cleanup step so unapplied environments do not create a
  // redundant duplicate index under the older name.
  pgm.dropIndex('nominations', undefined, {
    concurrently: true,
    ifExists: true,
    name: 'idx_nominations_unprocessed',
  });
};

exports.down = (pgm) => {
  // Restore the legacy index definition so rolling back this migration
  // returns older environments to their pre-migration schema state.
  pgm.createIndex('nominations', [{ name: 'updated_at', sort: 'desc' }], {
    concurrently: true,
    ifNotExists: true,
    name: 'idx_nominations_unprocessed',
    where: "lifecycle_state != 'processed'",
  });
};
