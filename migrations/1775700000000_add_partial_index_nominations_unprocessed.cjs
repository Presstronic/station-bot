exports.noTransaction = true;

exports.up = (pgm) => {
  pgm.createIndex('nominations', [{ name: 'updated_at', sort: 'DESC' }], {
    name: 'idx_nominations_unprocessed',
    concurrently: true,
    ifNotExists: true,
    where: "lifecycle_state != 'processed'",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('nominations', [{ name: 'updated_at', sort: 'DESC' }], {
    name: 'idx_nominations_unprocessed',
    concurrently: true,
    ifExists: true,
  });
};
