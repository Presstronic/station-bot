import { getManufacturingConfig } from '../../config/manufacturing.config.js';
import * as repository from './manufacturing.repository.js';
import {
  TERMINAL_STATUSES,
  VALID_TRANSITIONS,
  InvalidStatusTransitionError,
  OrderCancelForbiddenError,
  OrderLimitExceededError,
  OrderNotFoundError,
  type ManufacturingOrder,
  type NewOrderItem,
  type OrderStatus,
} from './types.js';

export async function submitOrder(
  userId: string,
  username: string,
  items: NewOrderItem[],
): Promise<ManufacturingOrder> {
  const { orderLimit } = getManufacturingConfig();
  const activeCount = await repository.countActiveByUserId(userId);
  if (activeCount >= orderLimit) {
    throw new OrderLimitExceededError(orderLimit);
  }
  return repository.create(userId, username, items);
}

export async function transitionStatus(
  orderId: number,
  newStatus: OrderStatus,
  _actorId: string,
): Promise<ManufacturingOrder> {
  const order = await repository.findById(orderId);
  if (!order) throw new OrderNotFoundError(orderId);

  if (!VALID_TRANSITIONS[order.status].includes(newStatus)) {
    throw new InvalidStatusTransitionError(order.status, newStatus);
  }

  return repository.updateStatus(orderId, newStatus);
}

export async function cancelOrder(
  orderId: number,
  actorId: string,
  isStaff: boolean,
): Promise<ManufacturingOrder> {
  const order = await repository.findById(orderId);
  if (!order) throw new OrderNotFoundError(orderId);

  if (TERMINAL_STATUSES.includes(order.status)) {
    throw new InvalidStatusTransitionError(order.status, 'cancelled');
  }

  if (!isStaff) {
    if (order.discordUserId !== actorId) {
      throw new OrderCancelForbiddenError('You can only cancel your own orders');
    }
    if (order.status !== 'new' && order.status !== 'accepted') {
      throw new OrderCancelForbiddenError(
        'Members may only cancel orders with status New or Accepted',
      );
    }
  }

  return repository.updateStatus(orderId, 'cancelled');
}
