/* eslint-disable camelcase */

exports.shorthands = undefined;

const jobStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'];
const jobScopes = ['all', 'single'];
const itemStatuses = ['pending', 'running', 'completed', 'failed'];

exports.up = (pgm) => {
  pgm.createTable('nomination_check_jobs', {
    id: 'id',
    created_by_user_id: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'queued' },
    requested_scope: { type: 'text', notNull: true },
    requested_handle: { type: 'text' },
    total_count: { type: 'integer', notNull: true, default: 0 },
    completed_count: { type: 'integer', notNull: true, default: 0 },
    failed_count: { type: 'integer', notNull: true, default: 0 },
    error_summary: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    started_at: { type: 'timestamptz' },
    finished_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createTable('nomination_check_job_items', {
    id: 'id',
    job_id: {
      type: 'integer',
      notNull: true,
      references: 'nomination_check_jobs(id)',
      onDelete: 'CASCADE',
    },
    normalized_handle: {
      type: 'text',
      notNull: true,
      references: 'nominations(normalized_handle)',
      onDelete: 'CASCADE',
    },
    status: { type: 'text', notNull: true, default: 'pending' },
    attempt_count: { type: 'integer', notNull: true, default: 0 },
    last_error: { type: 'text' },
    locked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint(
    'nomination_check_jobs',
    'nomination_check_jobs_status_valid',
    `CHECK (status IN (${jobStatuses.map((status) => `'${status}'`).join(', ')}))`
  );

  pgm.addConstraint(
    'nomination_check_jobs',
    'nomination_check_jobs_scope_valid',
    `CHECK (requested_scope IN (${jobScopes.map((scope) => `'${scope}'`).join(', ')}))`
  );

  pgm.addConstraint(
    'nomination_check_job_items',
    'nomination_check_job_items_status_valid',
    `CHECK (status IN (${itemStatuses.map((status) => `'${status}'`).join(', ')}))`
  );

  pgm.addConstraint(
    'nomination_check_job_items',
    'nomination_check_job_items_attempt_count_non_negative',
    'CHECK (attempt_count >= 0)'
  );

  pgm.addConstraint(
    'nomination_check_job_items',
    'nomination_check_job_items_job_handle_unique',
    'UNIQUE (job_id, normalized_handle)'
  );

  pgm.createIndex('nomination_check_jobs', ['status', 'created_at'], {
    name: 'idx_nomination_check_jobs_status_created_at',
  });
  pgm.createIndex('nomination_check_job_items', ['job_id', 'status'], {
    name: 'idx_nomination_check_job_items_job_status',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('nomination_check_job_items', ['job_id', 'status'], {
    name: 'idx_nomination_check_job_items_job_status',
  });
  pgm.dropIndex('nomination_check_jobs', ['status', 'created_at'], {
    name: 'idx_nomination_check_jobs_status_created_at',
  });

  pgm.dropConstraint('nomination_check_job_items', 'nomination_check_job_items_job_handle_unique');
  pgm.dropConstraint('nomination_check_job_items', 'nomination_check_job_items_attempt_count_non_negative');
  pgm.dropConstraint('nomination_check_job_items', 'nomination_check_job_items_status_valid');
  pgm.dropConstraint('nomination_check_jobs', 'nomination_check_jobs_scope_valid');
  pgm.dropConstraint('nomination_check_jobs', 'nomination_check_jobs_status_valid');

  pgm.dropTable('nomination_check_job_items');
  pgm.dropTable('nomination_check_jobs');
};
