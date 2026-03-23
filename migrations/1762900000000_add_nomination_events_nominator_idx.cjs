exports.up = (pgm) => {
  pgm.createIndex('nomination_events', ['nominator_user_id', 'created_at'], {
    name: 'nomination_events_nominator_user_id_created_at_idx',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('nomination_events', ['nominator_user_id', 'created_at'], {
    name: 'nomination_events_nominator_user_id_created_at_idx',
  });
};
