<?php

namespace App\Services;

use App\Models\DamagedItem;
use App\Models\products;
use App\Models\User;
use App\Models\WalletAuditLog;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records damaged stock and keeps products.stock correct.
 *
 * The product row is locked (same lock InvoiceCreationService takes), so a sale
 * and a damage entry can never both spend the last unit.
 * Damaged units are NOT sales: products.total_sold is never touched.
 */
class DamagedStockService
{
    /**
     * @param  array{product_id:int,quantity:int,reason:string,unit_value?:string|float|null,damaged_on:string,notes?:?string,idempotency_key?:?string}  $data
     */
    public function record(array $data, User $user, ?string $imagePath = null, ?string $ip = null): DamagedItem
    {
        return DB::transaction(function () use ($data, $user, $imagePath, $ip): DamagedItem {
            $product = products::query()->lockForUpdate()->find($data['product_id']);

            if (! $product) {
                $this->fail('product_id', 'المنتج غير موجود.');
            }

            $key = $data['idempotency_key'] ?? null;
            if ($key) {
                $existing = DamagedItem::query()->where('idempotency_key', $key)->first();
                if ($existing) {
                    return $existing;
                }
            }

            $quantity = (int) $data['quantity'];
            $stock = (int) $product->stock;

            if ($quantity < 1) {
                $this->fail('quantity', 'الكمية يجب أن تكون 1 على الأقل.');
            }
            if ($quantity > $stock) {
                $this->fail('quantity', "الكمية أكبر من المخزون المتاح ({$stock}).");
            }

            // Value per unit: what the shop lost per piece. Defaults to the selling price.
            $unitCents = isset($data['unit_value']) && $data['unit_value'] !== ''
                ? Money::cents($data['unit_value'])
                : Money::cents($product->price);

            $item = DamagedItem::query()->forceCreate([
                'product_id' => $product->id,
                'product_name' => $product->name,
                'product_barcode' => $product->barcode,
                'quantity' => $quantity,
                'unit_value' => Money::decimal($unitCents),
                'total_value' => Money::decimal($unitCents * $quantity),
                'reason' => $data['reason'],
                'notes' => $this->clean($data['notes'] ?? null, 500),
                'image_path' => $imagePath,
                'damaged_on' => $data['damaged_on'],
                'stock_before' => $stock,
                'stock_after' => $stock - $quantity,
                'status' => 'recorded',
                'idempotency_key' => $key ?: null,
                'created_by' => $user->id,
                'created_by_name' => $user->name,
            ]);

            $product->stock = $stock - $quantity;
            $product->save();

            $this->audit($user, 'damaged.recorded', $item->id, [
                'product_id' => $product->id,
                'quantity' => $quantity,
                'reason' => $data['reason'],
                'total_value' => $item->total_value,
            ], $ip);

            return $item;
        }, 3);
    }

    /**
     * Correct an active entry (quantity, reason, unit value, date, notes).
     * The stock difference is applied to the product in the same transaction,
     * and the change is written to the audit log with the old and new values.
     *
     * @param  array{quantity:int,reason:string,unit_value?:string|float|null,damaged_on:string,notes?:?string}  $data
     */
    public function update(DamagedItem $item, array $data, User $user, ?string $ip = null): DamagedItem
    {
        return DB::transaction(function () use ($item, $data, $user, $ip): DamagedItem {
            // Same lock order as record()/void(): product first, then the record.
            $product = $item->product_id
                ? products::query()->lockForUpdate()->find($item->product_id)
                : null;
            $locked = DamagedItem::query()->lockForUpdate()->findOrFail($item->id);

            if ($locked->isVoided()) {
                $this->fail('item', 'لا يمكن تعديل سجل ملغى.');
            }

            $oldQuantity = (int) $locked->quantity;
            $newQuantity = (int) $data['quantity'];
            if ($newQuantity < 1) {
                $this->fail('quantity', 'الكمية يجب أن تكون 1 على الأقل.');
            }

            $delta = $newQuantity - $oldQuantity;
            if ($delta !== 0) {
                if (! $product) {
                    $this->fail('quantity', 'المنتج لم يعد موجوداً، لا يمكن تغيير الكمية. ألغِ السجل بدلاً من ذلك.');
                }
                if ($delta > (int) $product->stock) {
                    $this->fail('quantity', 'الزيادة أكبر من المخزون المتاح ('.(int) $product->stock.').');
                }
                $product->stock = (int) $product->stock - $delta;
                $product->save();
            }

            $unitCents = isset($data['unit_value']) && $data['unit_value'] !== ''
                ? Money::cents($data['unit_value'])
                : Money::cents($locked->unit_value);

            $before = [
                'quantity' => $oldQuantity,
                'reason' => $locked->reason,
                'unit_value' => (string) $locked->unit_value,
                'damaged_on' => $locked->damaged_on?->toDateString(),
                'notes' => $locked->notes,
            ];

            DamagedItem::whileServiceEditing(function () use ($locked, $data, $newQuantity, $unitCents): void {
                $locked->forceFill([
                    'quantity' => $newQuantity,
                    'unit_value' => Money::decimal($unitCents),
                    'total_value' => Money::decimal($unitCents * $newQuantity),
                    'reason' => $data['reason'],
                    'notes' => $this->clean($data['notes'] ?? null, 500),
                    'damaged_on' => $data['damaged_on'],
                    'stock_after' => (int) $locked->stock_before - $newQuantity,
                ])->save();
            });

            $this->audit($user, 'damaged.updated', $locked->id, [
                'before' => $before,
                'after' => [
                    'quantity' => $newQuantity,
                    'reason' => $data['reason'],
                    'unit_value' => Money::decimal($unitCents),
                    'damaged_on' => $data['damaged_on'],
                    'notes' => $this->clean($data['notes'] ?? null, 500),
                ],
                'stock_delta' => -$delta,
            ], $ip);

            return $locked->refresh();
        }, 3);
    }

    /**
     * Cancel a mistaken entry. The units go back to stock and the record stays,
     * marked as voided, with who did it and why.
     */
    public function void(DamagedItem $item, string $reason, User $user, ?string $ip = null): DamagedItem
    {
        return DB::transaction(function () use ($item, $reason, $user, $ip): DamagedItem {
            // Lock the product first (same order as record()), then the record.
            $product = $item->product_id
                ? products::query()->lockForUpdate()->find($item->product_id)
                : null;
            $locked = DamagedItem::query()->lockForUpdate()->findOrFail($item->id);

            if ($locked->isVoided()) {
                $this->fail('item', 'تم إلغاء هذا السجل من قبل.');
            }

            // If the product was deleted meanwhile there is no stock row to restore.
            if ($product) {
                $product->stock = (int) $product->stock + $locked->quantity;
                $product->save();
            }

            $locked->forceFill([
                'status' => 'voided',
                'voided_at' => now(),
                'voided_by' => $user->id,
                'void_reason' => $this->clean($reason, 255),
            ])->save();

            $this->audit($user, 'damaged.voided', $locked->id, [
                'quantity' => $locked->quantity,
                'stock_restored' => $product !== null,
                'reason' => $reason,
            ], $ip);

            return $locked;
        }, 3);
    }

    private function audit(User $user, string $action, int $subjectId, array $meta, ?string $ip): void
    {
        WalletAuditLog::query()->forceCreate([
            'user_id' => $user->id,
            'user_name' => $user->name,
            'action' => $action,
            'subject_type' => 'damaged_item',
            'subject_id' => $subjectId,
            'meta' => $meta ?: null,
            'ip' => $ip,
        ]);
    }

    private function clean(?string $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) preg_replace('/\s+/u', ' ', $value));

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
