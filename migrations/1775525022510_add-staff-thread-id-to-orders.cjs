exports.up = (pgm) => {
  pgm.addColumn('manufacturing_orders', {
    staff_thread_id: { type: 'varchar(255)', notNull: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('manufacturing_orders', 'staff_thread_id');
};
