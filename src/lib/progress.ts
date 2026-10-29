export function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function platesRemaining(item: { qtyTotal: number; qtyDone: number; copiesPerPlate: number }): number {
  const left = Math.max(0, item.qtyTotal - item.qtyDone);
  return Math.ceil(left / Math.max(1, item.copiesPerPlate));
}
