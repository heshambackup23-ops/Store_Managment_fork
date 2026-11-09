package com.storemanagement.mobile.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.preferencesDataStore by preferencesDataStore(name = "app_preferences")

@Singleton
class AppPreferencesRepository @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val darkThemeKey = booleanPreferencesKey("dark_theme")

    val isDarkTheme: Flow<Boolean> = context.preferencesDataStore.data.map { preferences ->
        preferences[darkThemeKey] ?: false
    }

    suspend fun setDarkTheme(enabled: Boolean) {
        context.preferencesDataStore.edit { preferences ->
            preferences[darkThemeKey] = enabled
        }
    }
}
