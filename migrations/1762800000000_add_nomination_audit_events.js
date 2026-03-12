exports.up = (pgm) => {
  pgm.createTable('nomination_audit_events', {
    id:             'id',
    event_type:     { type: 'text', notNull: true },
    actor_user_id:  { type: 'text', notNull: true },
    actor_user_tag: { type: 'text', notNull: true },
    target_handle:  { type: 'text' },
    target_role_id: { type: 'text' },
    payload_json:   { type: 'jsonb' },
    result:         { type: 'text', notNull: true },
    error_message:  { type: 'text' },
    correlation_id: { type: 'text' },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('nomination_audit_events', ['created_at'], {
    name: 'idx_audit_events_created_at',
  });
  pgm.createIndex('nomination_audit_events', ['event_type', 'created_at'], {
    name: 'idx_audit_events_type_created_at',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('nomination_audit_events');
};
