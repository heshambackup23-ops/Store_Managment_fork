package com.storemanagement.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

internal val HilalNavigation = Color(0xFF15372C)
internal val HilalNavigationContent = Color(0xFFF2FAF2)
internal val HilalNavigationMuted = Color(0xFFBDD7C6)
internal val HilalNavigationSelected = Color(0xFF275541)

private val StoreLightColors = lightColorScheme(
    primary = Color(0xFF22563E),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE3EFE3),
    onPrimaryContainer = Color(0xFF15372C),
    secondary = Color(0xFF8F4C21),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFF7ECDC),
    onSecondaryContainer = Color(0xFF573013),
    tertiary = Color(0xFF385678),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFEAF0F7),
    onTertiaryContainer = Color(0xFF223C56),
    background = Color(0xFFF6F7F2),
    onBackground = Color(0xFF192D25),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFEDF3EB),
    onSurface = Color(0xFF192D25),
    onSurfaceVariant = Color(0xFF52665B),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF6F7F2),
    surfaceContainer = Color(0xFFF0F4EF),
    surfaceContainerHigh = Color(0xFFEDF3EB),
    surfaceContainerHighest = Color(0xFFE3EFE3),
    outline = Color(0xFF6C8274),
    outlineVariant = Color(0xFFD7E1D8),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
)

private val HilalShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(11.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(18.dp),
    extraLarge = RoundedCornerShape(22.dp),
)

private val DefaultTypography = Typography()
private val HilalTypography = DefaultTypography.copy(
    headlineMedium = DefaultTypography.headlineMedium.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
    headlineSmall = DefaultTypography.headlineSmall.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold),
    titleLarge = DefaultTypography.titleLarge.copy(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold),
    titleMedium = DefaultTypography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
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
        shapes = HilalShapes,
        typography = HilalTypography,
        content = content,
    )
}
