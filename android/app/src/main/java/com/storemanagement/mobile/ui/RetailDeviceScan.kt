package com.storemanagement.mobile.ui

private val imeiLabel = Regex("""(?i)^IMEI(?:\s*[12])?\s*[:=]\s*([0-9٠-٩۰-۹ ]+)$""")
private val serialLabel = Regex("""(?i)^(?:S/?N|SERIAL(?:\s+NUMBER)?)\s*[:=]\s*(.+)$""")

/** Some manufacturers print a plain identifier and others encode labeled lines on the carton. */
internal fun retailScannedIdentifier(value: String?): String? {
    val text = value?.trim()?.takeIf { it.length in 1..1024 } ?: return null
    val lines = text.lineSequence().map(String::trim).filter(String::isNotBlank).toList()
    val imei = lines.firstNotNullOfOrNull { line ->
        imeiLabel.matchEntire(line)?.groupValues?.get(1)?.normalizeArabicDigits()
            ?.replace(" ", "")?.takeIf { it.length == 15 }
    }
    if (imei != null) return imei
    val serial = lines.firstNotNullOfOrNull { line -> serialLabel.matchEntire(line)?.groupValues?.get(1) }
    val identifier = serial ?: lines.singleOrNull() ?: return null
    if (identifier.length !in 1..100 || identifier.any { Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() }) return null
    if ("://" in identifier || identifier.first() in listOf('{', '[', '<')) return null
    val digits = identifier.normalizeArabicDigits().replace(" ", "")
    return if (digits.length == 15 && digits.all { it in '0'..'9' }) digits else identifier
}
