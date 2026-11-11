package com.storemanagement.mobile.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import com.storemanagement.mobile.core.network.ConnectionMonitor
import com.storemanagement.mobile.core.network.ConnectionState
import com.storemanagement.mobile.core.network.ConnectionStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import javax.inject.Inject

@HiltViewModel
class ConnectionViewModel @Inject constructor(
    private val monitor: ConnectionMonitor,
) : ViewModel() {
    val state = monitor.state

    fun resume() = monitor.start()

    fun pause() = monitor.stop()

    fun checkNow() = monitor.checkNow()
}

internal fun ConnectionStatus.isProblem(): Boolean =
    this == ConnectionStatus.Offline || this == ConnectionStatus.ServerUnreachable

/**
 * Slides in under the top bar when the phone is offline or the server does not answer,
 * and briefly confirms when the connection comes back.
 */
@Composable
internal fun ConnectionBanner(
    state: ConnectionState,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var hadProblem by remember { mutableStateOf(false) }
    var showRestored by remember { mutableStateOf(false) }

    LaunchedEffect(state.status) {
        when {
            state.status.isProblem() -> {
                hadProblem = true
                showRestored = false
            }
            state.status == ConnectionStatus.Online && hadProblem -> {
                showRestored = true
                delay(3_000)
                showRestored = false
                hadProblem = false
            }
        }
    }

    AnimatedVisibility(
        visible = state.status.isProblem() || showRestored,
        enter = expandVertically() + fadeIn(),
        exit = shrinkVertically() + fadeOut(),
        modifier = modifier,
    ) {
        val problem = state.status.isProblem()
        val container = when {
            !problem -> MaterialTheme.colorScheme.primaryContainer
            state.status == ConnectionStatus.Offline -> MaterialTheme.colorScheme.errorContainer
            else -> MaterialTheme.colorScheme.secondaryContainer
        }
        val content = when {
            !problem -> MaterialTheme.colorScheme.onPrimaryContainer
            state.status == ConnectionStatus.Offline -> MaterialTheme.colorScheme.onErrorContainer
            else -> MaterialTheme.colorScheme.onSecondaryContainer
        }
        val message = when (state.status) {
            ConnectionStatus.Offline -> "لا يوجد اتصال بالإنترنت. البيانات المعروضة قد لا تكون محدثة."
            ConnectionStatus.ServerUnreachable -> "تعذر الوصول إلى الخادم. سنعيد المحاولة تلقائياً."
            else -> "تم استعادة الاتصال بالخادم"
        }
        Surface(color = container, contentColor = content, modifier = Modifier.fillMaxWidth()) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    imageVector = when {
                        !problem -> Icons.Filled.CheckCircle
                        state.status == ConnectionStatus.Offline -> Icons.Filled.WifiOff
                        else -> Icons.Filled.CloudOff
                    },
                    contentDescription = null,
                    modifier = Modifier.size(20.dp),
                )
                Text(
                    message,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                )
                if (problem) {
                    TextButton(onClick = onRetry) { Text("إعادة المحاولة") }
                }
            }
        }
    }
}

/** Small status pill for the top bar: a coloured dot plus a short Arabic label. Tap to re-check now. */
@Composable
internal fun ConnectionPill(
    state: ConnectionState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val dotColor: Color
    val label: String
    when (state.status) {
        ConnectionStatus.Online -> {
            dotColor = MaterialTheme.colorScheme.primary
            label = state.latencyMillis?.let { "متصل · ${it}ms" } ?: "متصل"
        }
        ConnectionStatus.Checking -> {
            dotColor = MaterialTheme.colorScheme.secondary
            label = "جارٍ الفحص"
        }
        ConnectionStatus.ServerUnreachable -> {
            dotColor = MaterialTheme.colorScheme.tertiary
            label = "الخادم لا يستجيب"
        }
        ConnectionStatus.Offline -> {
            dotColor = MaterialTheme.colorScheme.error
            label = "غير متصل"
        }
    }
    val pulse = rememberInfiniteTransition(label = "connection-pulse")
    val pulseAlpha by pulse.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "connection-pulse-alpha",
    )
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier
                    .size(9.dp)
                    .alpha(if (state.status == ConnectionStatus.Checking) pulseAlpha else 1f)
                    .background(dotColor, CircleShape),
            )
            Spacer(Modifier.width(6.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1)
        }
    }
}
