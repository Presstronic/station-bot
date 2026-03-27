/* eslint-disable camelcase */

exports.shorthands = undefined;

// Wipes all transactional and user/role configuration data for a clean beta start.
// The schema and pgmigrations system table are preserved.
//
// Tables cleared:
//   nomination_check_job_items  — job item results (FK child of nomination_check_jobs)
//   nomination_check_jobs       — queued/completed org-check jobs
//   nomination_audit_events     — audit trail
//   nomination_events           — anti-abuse counters (FK child of nominations)
//   nominations                 — all nomination records
//   nomination_access_roles     — Discord role configuration (re-configure via /nomination-access)
//
// Down: no-op — wiped data cannot be restored.

exports.up = (pgm) => {
  pgm.sql(`
    TRUNCATE
      nomination_check_job_items,
      nomination_check_jobs,
      nomination_audit_events,
      nomination_events,
      nominations,
      nomination_access_roles
    RESTART IDENTITY
    CASCADE
  `);
};

exports.down = (_pgm) => {
  // Intentional no-op: data wipes are irreversible.
};
