exports.up = (pgm) => {
  pgm.createTable('guild_configs', {
    guild_id: { type: 'text', primaryKey: true },

    // Verification
    verification_enabled:          { type: 'boolean', notNull: true, default: true },
    verified_role_name:            { type: 'text',    notNull: true, default: 'Verified' },
    temp_member_role_name:         { type: 'text',    notNull: true, default: 'Temporary Member' },
    potential_applicant_role_name: { type: 'text',    notNull: true, default: 'Potential Applicant' },
    org_member_role_id:            { type: 'text',    notNull: false },
    org_member_role_name:          { type: 'text',    notNull: false },

    // Nomination digest
    nomination_digest_enabled:       { type: 'boolean', notNull: true, default: false },
    nomination_digest_channel_id:    { type: 'text',    notNull: false },
    nomination_digest_role_id:       { type: 'text',    notNull: false },
    nomination_digest_cron_schedule: { type: 'text',    notNull: true, default: '0 9 * * *' },

    // Manufacturing
    manufacturing_enabled:                   { type: 'boolean', notNull: true, default: false },
    manufacturing_forum_channel_id:          { type: 'text',    notNull: false },
    manufacturing_staff_channel_id:          { type: 'text',    notNull: false },
    manufacturing_role_id:                   { type: 'text',    notNull: false },
    manufacturing_create_order_thread_id:    { type: 'text',    notNull: false },
    manufacturing_order_limit:               { type: 'integer', notNull: true, default: 5 },
    manufacturing_max_items_per_order:       { type: 'integer', notNull: true, default: 10 },
    manufacturing_order_rate_limit_per_5min: { type: 'integer', notNull: true, default: 1 },
    manufacturing_order_rate_limit_per_hour: { type: 'integer', notNull: true, default: 5 },
    manufacturing_create_order_post_title:   { type: 'text',    notNull: true, default: '📋 Create Order' },
    manufacturing_create_order_post_message: { type: 'text',    notNull: true, default: 'Click the button below to submit a new manufacturing order.' },
    manufacturing_keepalive_cron_schedule:   { type: 'text',    notNull: true, default: '0 6 * * *' },

    // Temp Member purge
    purge_jobs_enabled:              { type: 'boolean', notNull: true, default: false },
    temp_member_hours_to_expire:     { type: 'integer', notNull: true, default: 48 },
    temp_member_purge_cron_schedule: { type: 'text',    notNull: true, default: '0 3 * * *' },

    // Birthday
    birthday_enabled:       { type: 'boolean', notNull: true, default: false },
    birthday_channel_id:    { type: 'text',    notNull: false },
    birthday_cron_schedule: { type: 'text',    notNull: true, default: '0 12 * * *' },

    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('guild_configs');
};
