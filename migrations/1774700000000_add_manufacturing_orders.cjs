const ORDER_STATUSES = ['new', 'accepted', 'processing', 'ready_for_pickup', 'complete', 'cancelled'];

exports.up = (pgm) => {
  pgm.createTable('manufacturing_orders', {
    id: 'id',
    discord_user_id:   { type: 'varchar(255)', notNull: true },
    discord_username:  { type: 'varchar(255)', notNull: true },
    forum_thread_id:   { type: 'varchar(255)', notNull: false },
    status:            { type: 'text', notNull: true, default: 'new' },
    created_at:        { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at:        { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint(
    'manufacturing_orders',
    'manufacturing_orders_status_valid',
    `CHECK (status IN (${ORDER_STATUSES.map((s) => `'${s}'`).join(', ')}))`
  );

  pgm.createIndex('manufacturing_orders', ['discord_user_id'], {
    name: 'idx_manufacturing_orders_discord_user_id',
  });

  pgm.createTable('manufacturing_order_items', {
    id:         'id',
    order_id:   {
      type: 'integer',
      notNull: true,
      references: '"manufacturing_orders"',
      onDelete: 'CASCADE',
    },
    item_name:     { type: 'varchar(255)', notNull: true },
    quantity:      { type: 'integer', notNull: true },
    priority_stat: { type: 'varchar(255)', notNull: true },
    note:          { type: 'varchar(255)', notNull: false },
    sort_order:    { type: 'integer', notNull: true },
  });

  pgm.addConstraint(
    'manufacturing_order_items',
    'manufacturing_order_items_quantity_positive',
    'CHECK (quantity > 0)'
  );

  pgm.createIndex('manufacturing_order_items', ['order_id'], {
    name: 'idx_manufacturing_order_items_order_id',
  });
};

exports.down = (pgm) => {
  pgm.dropTable('manufacturing_order_items');
  pgm.dropTable('manufacturing_orders');
};
