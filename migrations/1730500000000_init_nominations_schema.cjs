/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('nominations', {
    normalized_handle: { type: 'text', primaryKey: true, notNull: true },
    display_handle: { type: 'text', notNull: true },
    nomination_count: { type: 'integer', notNull: true, default: 0 },
    is_processed: { type: 'boolean', notNull: true, default: false },
    processed_by_user_id: { type: 'text' },
    processed_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    last_org_check_status: { type: 'text' },
    last_org_check_at: { type: 'timestamptz' },
  });

  pgm.createTable('nomination_events', {
    id: 'id',
    normalized_handle: {
      type: 'text',
      notNull: true,
      references: 'nominations(normalized_handle)',
      onDelete: 'CASCADE',
    },
    nominator_user_id: { type: 'text', notNull: true },
    nominator_user_tag: { type: 'text', notNull: true },
    reason: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createIndex('nomination_events', ['normalized_handle', 'created_at'], {
    name: 'idx_nomination_events_handle_created_at',
  });

  pgm.createTable('nomination_access_roles', {
    role_id: { type: 'text', primaryKey: true, notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('nomination_access_roles');
  pgm.dropTable('nomination_events');
  pgm.dropTable('nominations');
};
