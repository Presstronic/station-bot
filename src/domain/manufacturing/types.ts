export type OrderStatus =
  | 'new'
  | 'accepted'
  | 'processing'
  | 'ready_for_pickup'
  | 'complete'
  | 'cancelled';

export const TERMINAL_STATUSES: ReadonlyArray<OrderStatus> = Object.freeze(['complete', 'cancelled']);

export const VALID_TRANSITIONS: Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>> = Object.freeze({
  new:              Object.freeze(['accepted', 'cancelled']),
  accepted:         Object.freeze(['processing', 'cancelled']),
  processing:       Object.freeze(['ready_for_pickup', 'cancelled']),
  ready_for_pickup: Object.freeze(['complete', 'cancelled']),
  complete:         Object.freeze([]),
  cancelled:        Object.freeze([]),
} as Record<OrderStatus, ReadonlyArray<OrderStatus>>);

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
