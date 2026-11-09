package com.storemanagement.mobile.core.database

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun provideCatalogDatabase(@ApplicationContext context: Context): CatalogDatabase =
        Room.databaseBuilder(context, CatalogDatabase::class.java, "store-catalog.db").build()

    @Provides
    fun provideCatalogDao(database: CatalogDatabase): CatalogDao = database.catalogDao()
}
