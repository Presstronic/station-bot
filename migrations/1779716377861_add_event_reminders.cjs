const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function envBool(name) {
  const raw = (process.env[name] || '').trim().toLowerCase();
  return raw === '' ? undefined : TRUE_VALUES.has(raw);
}

function envStr(name) {
  const raw = (process.env[name] || '').trim();
  return raw === '' ? undefined : raw;
}

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
  // Cleanup job filters by sent_at, so a supporting index keeps the
  // retention pass fast as the ledger grows.
  pgm.createIndex('event_reminders', 'sent_at');

  pgm.createTable('event_state', {
    event_id:              { type: 'text',       primaryKey: true },
    guild_id:              { type: 'text',       notNull: true },
    last_known_start_time: { type: 'timestamptz', notNull: true },
    updated_at:            { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
  pgm.createIndex('event_state', 'guild_id');
  // Cleanup filters by last_known_start_time (events whose start has long
  // since passed are eligible for pruning); index it for the retention pass.
  pgm.createIndex('event_state', 'last_known_start_time');

  // One-time backfill for existing guild rows. When operators upgrade and
  // set EVENT_REMINDERS_* env vars at deploy time, this populates existing
  // guild_configs rows so they pick up the feature without manual SQL or
  // running /configure for every guild. After this migration, guild_configs
  // is the per-guild source of truth and env-driven overrides are not
  // re-applied.
  const enabled = envBool('EVENT_REMINDERS_ENABLED');
  const defaultChannelId = envStr('EVENT_REMINDERS_DEFAULT_CHANNEL_ID');
  const cronSchedule = envStr('EVENT_REMINDERS_CRON_SCHEDULE');

  const setClauses = [];
  const params = {};
  if (enabled !== undefined) {
    params.enabled = enabled;
    setClauses.push('event_reminders_enabled = {enabled}');
  }
  if (defaultChannelId !== undefined) {
    params.defaultChannelId = defaultChannelId;
    setClauses.push('event_reminders_default_channel_id = {defaultChannelId}');
  }
  if (cronSchedule !== undefined) {
    params.cronSchedule = cronSchedule;
    setClauses.push('event_reminders_cron_schedule = {cronSchedule}');
  }
  if (setClauses.length > 0) {
    setClauses.push('updated_at = NOW()');
    pgm.sql(`UPDATE guild_configs SET ${setClauses.join(', ')}`, params);
  }
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
