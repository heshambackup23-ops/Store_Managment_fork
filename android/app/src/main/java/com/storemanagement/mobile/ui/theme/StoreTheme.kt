package com.storemanagement.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val StoreLightColors = lightColorScheme(
    primary = Color(0xFF176B58),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFC5EBDD),
    onPrimaryContainer = Color(0xFF002117),
    secondary = Color(0xFF805400),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFDEA6),
    onSecondaryContainer = Color(0xFF281900),
    tertiary = Color(0xFF9B4031),
    onTertiary = Color(0xFFFFFFFF),
    background = Color(0xFFF1F4EF),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE4E9E2),
    onSurface = Color(0xFF191D1A),
    onSurfaceVariant = Color(0xFF414943),
    outline = Color(0xFF727971),
    outlineVariant = Color(0xFFD3DAD1),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val StoreDarkColors = darkColorScheme(
    primary = Color(0xFF9CD6C1),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF00513D),
    onPrimaryContainer = Color(0xFFB8F2DC),
    secondary = Color(0xFFFFBA42),
    onSecondary = Color(0xFF432C00),
    secondaryContainer = Color(0xFF604000),
    onSecondaryContainer = Color(0xFFFFDEA6),
    tertiary = Color(0xFFFFB4A5),
    onTertiary = Color(0xFF5F160B),
    background = Color(0xFF111915),
    surface = Color(0xFF111915),
    surfaceVariant = Color(0xFF414943),
    onSurface = Color(0xFFE0E4DE),
    onSurfaceVariant = Color(0xFFC0C9C1),
    error = Color(0xFFFFB4AB),
)

@Composable
fun StoreTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) StoreDarkColors else StoreLightColors,
        content = content,
    )
}
