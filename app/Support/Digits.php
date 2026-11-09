<?php

namespace App\Support;

final class Digits
{
    private const MAP = [
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
        '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٫' => '.', '٬' => '',
    ];

    /** Arabic-Indic digits and separators -> ASCII. */
    public static function ascii(?string $value): ?string
    {
        return $value === null ? null : strtr($value, self::MAP);
    }

    /**
     * Normalise a phone number or InstaPay address typed or pasted by a person:
     * ASCII digits; no spaces, dashes, dots or brackets; no invisible direction marks
     * (numbers copied from WhatsApp or contacts often carry U+202A..U+202E and non-breaking
     * spaces that look empty but make a valid number fail); InstaPay address in lowercase.
     */
    public static function identifier(?string $value): string
    {
        $value = (string) self::ascii($value);
        $value = (string) preg_replace('/[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}\x{00A0}]/u', '', $value);
        $value = trim($value);

        if (str_contains($value, '@')) {
            return mb_strtolower($value);
        }

        return (string) preg_replace('/[\s\-().]+/', '', $value);
    }

    /**
     * Any real phone number: digits only, an optional leading +, 6 to 15 digits (the
     * international maximum). Mobile, landline and foreign numbers all pass; no prefix such
     * as 010 is required. Call identifier() first.
     */
    public static function isPhoneNumber(string $value): bool
    {
        return (bool) preg_match('/^\+?\d{6,15}$/', $value);
    }

    /** A phone number or an InstaPay address. */
    public static function isPhoneOrInstapay(string $value): bool
    {
        return self::isPhoneNumber($value) || self::isInstapayAddress($value);
    }

    public static function isEgyptianMobile(string $value): bool
    {
        return (bool) preg_match('/^01[0125]\d{8}$/', $value);
    }

    public static function isInstapayAddress(string $value): bool
    {
        return (bool) preg_match('/^[a-z0-9._-]{3,64}@[a-z]{2,20}$/', $value);
    }
}
