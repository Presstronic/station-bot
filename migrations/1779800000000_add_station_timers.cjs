exports.up = (pgm) => {
  pgm.createTable('station_timers', {
    id: { type: 'uuid', primaryKey: true },
    guild_id: { type: 'text', notNull: true },
    discord_user_id: { type: 'text', notNull: true },
    user_timer_id: { type: 'integer', notNull: true },
    starter_display_name: { type: 'text', notNull: true },
    timer_label: { type: 'text', notNull: true },
    duration_minutes: { type: 'integer', notNull: true },
    due_at: { type: 'timestamptz', notNull: true },
    dm_sent_at: { type: 'timestamptz', notNull: false },
    channel_notification_sent_at: { type: 'timestamptz', notNull: false },
    status: { type: 'text', notNull: true, default: 'active' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createIndex('station_timers', ['status', 'due_at']);
  pgm.createIndex('station_timers', ['guild_id', 'status', 'due_at']);
  pgm.createIndex('station_timers', ['guild_id', 'discord_user_id', 'created_at']);
  pgm.createIndex(
    'station_timers',
    ['guild_id', 'discord_user_id', 'user_timer_id'],
    {
      unique: true,
      where: `status = 'active'`,
      name: 'station_timers_active_user_slot_idx',
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable('station_timers');
};
