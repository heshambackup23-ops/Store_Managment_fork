package com.storemanagement.mobile.core.database

import android.content.Context
import androidx.room.Room
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    private val migration1To2 = object : Migration(1, 2) {
        override fun migrate(db: SupportSQLiteDatabase) {
            db.execSQL("ALTER TABLE cached_products ADD COLUMN notes TEXT")
        }
    }

    @Provides
    @Singleton
    fun provideCatalogDatabase(@ApplicationContext context: Context): CatalogDatabase =
        Room.databaseBuilder(context, CatalogDatabase::class.java, "store-catalog.db")
            .addMigrations(migration1To2)
            .build()

    @Provides
    fun provideCatalogDao(database: CatalogDatabase): CatalogDao = database.catalogDao()
}
