export function appointmentOrder(query) {
  const sorts = query.sorts ?? [
    { key: query.sort || 'createdAt', direction: query.direction || 'desc' }
  ];
  const order = sorts.flatMap(({ key, direction }) =>
    (key === 'date' ? ['date', 'timeSlot'] : [key]).map((field) => ({ field, direction }))
  );
  if (query.sorts === undefined && query.sort === 'campus')
    order.push(
      { field: 'date', direction: query.direction || 'desc' },
      { field: 'timeSlot', direction: query.direction || 'desc' }
    );
  if (!order.some((item) => item.field === 'createdAt'))
    order.push({ field: 'createdAt', direction: 'desc' });
  order.push({ field: 'id', direction: 'desc' });
  return order;
}

export function readAppointmentCursor(value, order) {
  if (!value) return null;
  const parsed = JSON.parse(decodeURIComponent(value));
  if (
    !parsed ||
    parsed.order !== JSON.stringify(order) ||
    !Array.isArray(parsed.values) ||
    parsed.values.length !== order.length ||
    parsed.values.some((item, index) =>
      order[index].field === 'status'
        ? !Number.isInteger(item) || item < 0 || item > 4
        : typeof item !== 'string' || item.length > 128
    )
  )
    throw new Error('Invalid appointment cursor');
  return parsed.values;
}

export function appointmentCursor(row, order) {
  return encodeURIComponent(
    JSON.stringify({
      order: JSON.stringify(order),
      values: order.map((_, index) => row[`__page${index}`])
    })
  );
}
