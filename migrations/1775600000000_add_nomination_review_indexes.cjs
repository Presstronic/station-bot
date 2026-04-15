exports.up = (pgm) => {
  // Hot path: unprocessed review queue without a status filter.
  pgm.createIndex(
    'nominations',
    [{ name: 'updated_at', sort: 'desc' }],
    {
      name: 'idx_nominations_unprocessed_updated_at',
      where: "lifecycle_state != 'processed'",
    }
  );

  pgm.createIndex(
    'nominations',
    [
      { name: 'nomination_count', sort: 'desc' },
      { name: 'updated_at', sort: 'desc' },
    ],
    {
      name: 'idx_nominations_unprocessed_nomination_count_updated_at',
      where: "lifecycle_state != 'processed'",
    }
  );

  // Filtered path: specific lifecycle state with review sort variants.
  pgm.createIndex(
    'nominations',
    ['lifecycle_state', { name: 'updated_at', sort: 'desc' }],
    {
      name: 'idx_nominations_lifecycle_state_updated_at',
    }
  );

  pgm.createIndex(
    'nominations',
    [
      'lifecycle_state',
      { name: 'nomination_count', sort: 'desc' },
      { name: 'updated_at', sort: 'desc' },
    ],
    {
      name: 'idx_nominations_lifecycle_state_nomination_count_updated_at',
    }
  );

  // Superseded by the new lifecycle_state-prefixed composite indexes.
  pgm.dropIndex('nominations', undefined, {
    name: 'idx_nominations_lifecycle_state',
  });
};

exports.down = (pgm) => {
  pgm.createIndex('nominations', ['lifecycle_state'], {
    name: 'idx_nominations_lifecycle_state',
  });
  pgm.dropIndex('nominations', undefined, {
    name: 'idx_nominations_lifecycle_state_nomination_count_updated_at',
  });
  pgm.dropIndex('nominations', undefined, {
    name: 'idx_nominations_lifecycle_state_updated_at',
  });
  pgm.dropIndex('nominations', undefined, {
    name: 'idx_nominations_unprocessed_nomination_count_updated_at',
  });
  pgm.dropIndex('nominations', undefined, {
    name: 'idx_nominations_unprocessed_updated_at',
  });
};
