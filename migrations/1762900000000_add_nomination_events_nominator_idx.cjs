exports.up = (pgm) => {
  pgm.createIndex('nomination_events', ['nominator_user_id', 'created_at'], {
    name: 'idx_nomination_events_nominator_user_id_created_at',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('nomination_events', ['nominator_user_id', 'created_at'], {
    name: 'idx_nomination_events_nominator_user_id_created_at',
  });
};
