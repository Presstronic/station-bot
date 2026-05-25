exports.up = (pgm) => {
  pgm.addColumns('guild_configs', {
    event_reminders_enabled:            { type: 'boolean', notNull: true, default: false },
    event_reminders_default_channel_id: { type: 'text',    notNull: false },
    event_reminders_cron_schedule:      { type: 'text',    notNull: true, default: '*/15 * * * *' },
  });

  pgm.createTable('event_reminders', {
    id:           { type: 'bigserial',  primaryKey: true },
    guild_id:     { type: 'text',       notNull: true },
    event_id:     { type: 'text',       notNull: true },
    reminder_key: { type: 'text',       notNull: true },
    channel_id:   { type: 'text',       notNull: true },
    sent_at:      { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.addConstraint('event_reminders', 'event_reminders_event_window_uniq', {
    unique: ['event_id', 'reminder_key'],
  });
  pgm.createIndex('event_reminders', 'guild_id');

  pgm.createTable('event_state', {
    event_id:              { type: 'text',       primaryKey: true },
    guild_id:              { type: 'text',       notNull: true },
    last_known_start_time: { type: 'timestamptz', notNull: true },
    updated_at:            { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('event_state', 'guild_id');
};

exports.down = (pgm) => {
  pgm.dropTable('event_state');
  pgm.dropTable('event_reminders');
  pgm.dropColumns('guild_configs', [
    'event_reminders_enabled',
    'event_reminders_default_channel_id',
    'event_reminders_cron_schedule',
  ]);
};
