/* eslint-disable camelcase */

exports.up = async (pgm) => {
  pgm.createTable('exec_hangar_state', {
    id: { type: 'uuid', primaryKey: true },
    singleton_key: { type: 'text', notNull: true, unique: true },
    current_state: { type: 'text', notNull: false },
    next_change_at: { type: 'timestamptz', notNull: false },
    next_change_type: { type: 'text', notNull: false },
    last_synced_at: { type: 'timestamptz', notNull: false },
    sync_source: { type: 'text', notNull: false },
    open_duration_minutes: { type: 'integer', notNull: true, default: 60 },
    closed_duration_minutes: { type: 'integer', notNull: true, default: 120 },
    cycle_offset_ms: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('CURRENT_TIMESTAMP') },
  });

  pgm.addConstraint('exec_hangar_state', 'exec_hangar_state_current_state_check', {
    check: "(current_state IS NULL OR current_state IN ('OPEN', 'CLOSED'))",
  });
  pgm.addConstraint('exec_hangar_state', 'exec_hangar_state_next_change_type_check', {
    check: "(next_change_type IS NULL OR next_change_type IN ('OPEN', 'CLOSE'))",
  });

  pgm.sql(`
    INSERT INTO exec_hangar_state (
      id,
      singleton_key,
      current_state,
      next_change_at,
      next_change_type,
      last_synced_at,
      sync_source,
      open_duration_minutes,
      closed_duration_minutes,
      cycle_offset_ms
    ) VALUES (
      '019722c7-e4ae-7000-8000-000000000430',
      'global',
      NULL,
      NULL,
      NULL,
      NULL,
      NULL,
      60,
      120,
      0
    );
  `);
};

exports.down = async (pgm) => {
  pgm.dropTable('exec_hangar_state');
};
