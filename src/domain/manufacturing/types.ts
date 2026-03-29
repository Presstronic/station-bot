export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'processing'
  | 'ready_for_pickup'
  | 'complete'
  | 'cancelled';

export const TERMINAL_STATUSES = new Set<OrderStatus>(['complete', 'cancelled']);

export const VALID_TRANSITIONS = new Map<OrderStatus, ReadonlySet<OrderStatus>>([
  ['new',              new Set<OrderStatus>(['accepted', 'cancelled'])],
  ['accepted',         new Set<OrderStatus>(['processing', 'cancelled'])],
  ['processing',       new Set<OrderStatus>(['ready_for_pickup', 'cancelled'])],
  ['ready_for_pickup', new Set<OrderStatus>(['complete', 'cancelled'])],
  ['complete',         new Set<OrderStatus>()],
  ['cancelled',        new Set<OrderStatus>()],
]);

export interface ManufacturingOrderItem {
  id: number;
  orderId: number;
  itemName: string;
  quantity: number;
  priorityStat: string;
  note: string | null;
  sortOrder: number;
}

export type NewOrderItem = Omit<ManufacturingOrderItem, 'id' | 'orderId'>;

export interface ManufacturingOrder {
  id: number;
  discordUserId: string;
  discordUsername: string;
  forumThreadId: string | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  items: ManufacturingOrderItem[];
}

export class OrderLimitExceededError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Active order limit of ${limit} reached`);
    this.name = 'OrderLimitExceededError';
    this.limit = limit;
  }
}

export class InvalidStatusTransitionError extends Error {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = 'InvalidStatusTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class OrderNotFoundError extends Error {
  readonly orderId: number;
  constructor(orderId: number) {
    super(`Manufacturing order ${orderId} not found`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
  }
}

export class OrderCancelForbiddenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'OrderCancelForbiddenError';
  }
}
