import { listWarehouses, fetchStock, writeStock, log } from './deps';

export function syncInventory(skus: string[], dryRun: boolean) {
  return listWarehouses().then((warehouses) => {
    const updates: Array<{ warehouse: string; sku: string; qty: number }> = [];
    for (const warehouse of warehouses) {
      if (warehouse.active) {
        for (const sku of skus) {
          updates.push({ warehouse: warehouse.id, sku, qty: 0 });
        }
      }
    }
    return Promise.all(
      updates.map((update) =>
        fetchStock(update.warehouse, update.sku).then((qty) => {
          if (qty == null) {
            log(`no stock record for ${update.sku} in ${update.warehouse}`);
            return null;
          }
          if (dryRun) {
            log(`would write ${qty}`);
            return null;
          } else {
            return writeStock(update.warehouse, update.sku, qty).catch((err) => {
              if (err.code === 'Throttled' || err.code === 'Timeout' && err.retryable) {
                return writeStock(update.warehouse, update.sku, qty);
              }
              throw err;
            });
          }
        }),
      ),
    );
  });
}
