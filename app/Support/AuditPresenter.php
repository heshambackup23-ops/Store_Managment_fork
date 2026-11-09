<?php

namespace App\Support;

use App\Models\DamagedItem;
use App\Models\Wallet;
use App\Models\WalletAuditLog;

/**
 * Turns an audit-log row (English codes + raw JSON) into readable Arabic,
 * and lets the audit search work with Arabic words.
 */
final class AuditPresenter
{
    public const ACTIONS = [
        'transaction.created' => 'تسجيل عملية',
        'transaction.reversed' => 'عكس عملية',
        'transaction.settled' => 'تحصيل مبلغ آجل',
        'wallet.created' => 'إضافة محفظة',
        'wallet.updated' => 'تعديل محفظة',
        'wallet.activated' => 'تفعيل محفظة',
        'wallet.deactivated' => 'إيقاف محفظة',
        'wallet.adjusted' => 'تسوية رصيد محفظة',
        'expense.created' => 'تسجيل مصروف',
        'expense.voided' => 'إلغاء مصروف',
        'cash.adjusted' => 'حركة في الدرج',
        'profit.withdrawn' => 'سحب أرباح',
        'damaged.recorded' => 'تسجيل هالِك',
        'damaged.voided' => 'إلغاء سجل هالِك',
    ];

    public const SUBJECTS = [
        'wallet' => 'محفظة',
        'wallet_transaction' => 'عملية',
        'wallet_expense' => 'مصروف',
        'wallet_cash_adjustment' => 'حركة درج',
        'damaged_item' => 'هالِك',
    ];

    private const FIELDS = [
        'provider' => 'نوع المحفظة', 'opening_balance' => 'الرصيد الافتتاحي', 'delta' => 'مبلغ التسوية',
        'reason' => 'السبب', 'wallet_id' => 'المحفظة', 'type' => 'نوع العملية', 'amount' => 'المبلغ',
        'commission' => 'العمولة', 'method' => 'طريقة الدفع', 'reversal_id' => 'قيد العكس',
        'settlement_id' => 'قيد التحصيل', 'paid' => 'المحصَّل', 'remaining' => 'المتبقي', 'changed' => 'الحقول المعدّلة',
        'category' => 'البند', 'kind' => 'نوع الحركة', 'product_id' => 'المنتج', 'quantity' => 'الكمية',
        'total_value' => 'إجمالي القيمة', 'stock_restored' => 'إرجاع المخزون', 'source' => 'مصدر السحب', 'note' => 'ملاحظة',
    ];

    private const MONEY = ['opening_balance', 'delta', 'amount', 'commission', 'paid', 'remaining', 'total_value'];

    private const WORDS = [
        'type' => ['send' => 'تحويل', 'receive' => 'استلام'],
        'method' => ['cash' => 'نقدي', 'deferred' => 'آجل'],
        'source' => ['cash' => 'الدرج (نقدي)', 'wallet' => 'محفظة'],
        'kind' => [
            'opening' => 'رصيد افتتاحي للدرج', 'owner_deposit' => 'إيداع من المالك',
            'owner_withdraw' => 'سحب للمالك', 'correction' => 'تسوية', 'profit_withdraw' => 'سحب أرباح',
        ],
    ];

    private const CHANGED_FIELDS = [
        'name' => 'الاسم', 'provider' => 'النوع', 'identifier' => 'الرقم', 'holder_name' => 'اسم صاحب المحفظة',
        'per_transaction_limit' => 'حد العملية', 'daily_send_limit' => 'حد التحويل اليومي',
        'daily_receive_limit' => 'حد الاستلام اليومي', 'monthly_send_limit' => 'حد التحويل الشهري',
        'monthly_receive_limit' => 'حد الاستلام الشهري', 'warn_at_percent' => 'نسبة التنبيه',
        'default_commission_percent' => 'نسبة العمولة', 'default_commission_min' => 'أقل عمولة',
        'default_fee_percent' => 'نسبة رسوم المزود', 'default_fee_min' => 'أقل رسوم', 'default_fee_max' => 'أقصى رسوم',
        'is_active' => 'الحالة', 'notes' => 'ملاحظات',
    ];

    // ---------------------------------------------------------------- display

    /** @return array<string, mixed> */
    public static function row(WalletAuditLog $log): array
    {
        $action = (string) $log->action;
        $subject = self::SUBJECTS[$log->subject_type] ?? (string) $log->subject_type;

        return [
            'time' => $log->created_at?->format('Y-m-d H:i:s'),
            'user' => $log->user_name ?: '-',
            'action' => self::ACTIONS[$action] ?? $action,
            'badge' => self::badge($action),
            'subject' => $subject !== '' ? $subject.($log->subject_id ? ' #'.$log->subject_id : '') : '-',
            'details' => self::describe($action, $log->meta),
            'ip' => $log->ip,
        ];
    }

    /** @return array<int, array{0:string,1:string}> label / value pairs */
    public static function describe(string $action, ?array $meta): array
    {
        $pairs = [];

        foreach ($meta ?? [] as $key => $value) {
            $label = self::FIELDS[$key] ?? (string) $key;
            $pairs[] = [$label, self::value($action, (string) $key, $value)];
        }

        return $pairs;
    }

    private static function value(string $action, string $key, mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'نعم' : 'لا';
        }

        if ($value === null || $value === '') {
            return '-';
        }

        if ($key === 'changed' && is_array($value)) {
            return implode('، ', array_map(fn ($field) => self::CHANGED_FIELDS[$field] ?? $field, $value));
        }

        if (is_array($value)) {
            return json_encode($value, JSON_UNESCAPED_UNICODE) ?: '';
        }

        if ($key === 'provider') {
            return Wallet::PROVIDERS[$value] ?? (string) $value;
        }

        if ($key === 'reason' && str_starts_with($action, 'damaged.')) {
            return DamagedItem::REASONS[$value] ?? (string) $value;
        }

        if (isset(self::WORDS[$key][$value])) {
            return self::WORDS[$key][$value];
        }

        if (in_array($key, self::MONEY, true) && is_numeric($value)) {
            return number_format((float) $value, 2).' ج.م';
        }

        if (in_array($key, ['wallet_id', 'product_id', 'reversal_id', 'settlement_id'], true) && is_numeric($value)) {
            return '#'.$value;
        }

        return (string) $value;
    }

    public static function badge(string $action): string
    {
        return match (true) {
            str_contains($action, 'reversed'), str_contains($action, 'voided'), str_contains($action, 'deactivated') => 'text-bg-danger',
            str_contains($action, 'adjusted') => 'text-bg-warning',
            str_contains($action, 'settled'), str_contains($action, 'activated') => 'text-bg-success',
            str_contains($action, 'created'), str_contains($action, 'recorded') => 'text-bg-primary',
            str_contains($action, 'updated') => 'text-bg-info',
            default => 'text-bg-secondary',
        };
    }

    // ----------------------------------------------------------------- search

    /** Arabic search ignores diacritics (هالِك = هالك) and common letter variants. */
    public static function normalize(string $text): string
    {
        $text = (string) preg_replace('/[\x{064B}-\x{065F}\x{0670}\x{0640}]/u', '', $text);
        $text = strtr($text, ['أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ى' => 'ي', 'ة' => 'ه', 'ؤ' => 'و', 'ئ' => 'ي']);

        return mb_strtolower(trim($text));
    }

    /** @return list<string> action codes whose Arabic label (or code) contains the term */
    public static function actionsMatching(string $term): array
    {
        return self::matching(self::ACTIONS, $term);
    }

    /** @return list<string> subject types whose Arabic label (or code) contains the term */
    public static function subjectsMatching(string $term): array
    {
        return self::matching(self::SUBJECTS, $term);
    }

    private static function matching(array $labels, string $term): array
    {
        $needle = self::normalize($term);
        $raw = mb_strtolower(trim($term));

        if ($needle === '') {
            return [];
        }

        $found = [];
        foreach ($labels as $code => $label) {
            if (str_contains(self::normalize($label), $needle) || str_contains((string) $code, $raw)) {
                $found[] = (string) $code;
            }
        }

        return $found;
    }
}
