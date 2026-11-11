package com.storemanagement.mobile.core.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import dagger.hilt.android.qualifiers.ApplicationContext
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SecureTokenStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    // Decrypting through the Android Keystore on every request is slow; keep the token in memory.
    @Volatile
    private var cachedToken: String? = null

    @Synchronized
    fun readToken(): String? {
        cachedToken?.let { return it }
        val encrypted = preferences.getString(TOKEN_VALUE_KEY, null) ?: return null
        val iv = preferences.getString(TOKEN_IV_KEY, null) ?: return clearAndReturnNull()

        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(iv, Base64.NO_WRAP)),
            )
            String(Base64.decode(encrypted, Base64.NO_WRAP).let(cipher::doFinal), StandardCharsets.UTF_8)
                .also { cachedToken = it }
        } catch (_: Exception) {
            clearAndReturnNull()
        }
    }

    @Synchronized
    fun saveToken(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        cachedToken = null
        check(
            preferences.edit()
                .putString(TOKEN_IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString(TOKEN_VALUE_KEY, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .commit(),
        ) { "Unable to persist the encrypted session token." }
        cachedToken = token
    }

    @Synchronized
    fun clear() {
        cachedToken = null
        check(preferences.edit().clear().commit()) { "Unable to clear the encrypted session token." }
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private fun clearAndReturnNull(): String? {
        cachedToken = null
        preferences.edit().clear().commit()
        return null
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val KEY_ALIAS = "store-management-api-token"
        const val PREFERENCES_NAME = "secure_session"
        const val TOKEN_IV_KEY = "token_iv"
        const val TOKEN_VALUE_KEY = "token_value"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
    }
}
