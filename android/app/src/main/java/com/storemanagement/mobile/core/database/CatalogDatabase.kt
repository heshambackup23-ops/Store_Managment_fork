package com.storemanagement.mobile.core.database

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "cached_products")
data class CachedProduct(
    @PrimaryKey val id: Long,
    val name: String,
    val price: String,
    val description: String,
    val notes: String? = null,
    val barcode: String?,
    val stock: Int,
    val categoryId: Long?,
    val categoryName: String?,
    val imageUrl: String?,
    val serverUpdatedAt: String?,
    val cachedAtEpochMillis: Long,
)

@Entity(tableName = "cached_categories")
data class CachedCategory(
    @PrimaryKey val id: Long,
    val name: String,
    val productsCount: Int?,
    val cachedAtEpochMillis: Long,
)

@Dao
abstract class CatalogDao {
    @Query("SELECT * FROM cached_products ORDER BY id DESC LIMIT 1000")
    abstract fun observeProducts(): Flow<List<CachedProduct>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertProducts(products: List<CachedProduct>)

    @Query("SELECT MAX(cachedAtEpochMillis) FROM cached_products")
    abstract fun observeProductCacheTime(): Flow<Long?>

    @Query("SELECT * FROM cached_categories ORDER BY name, id")
    abstract fun observeCategories(): Flow<List<CachedCategory>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun upsertCategories(categories: List<CachedCategory>)

    @Query("DELETE FROM cached_products")
    abstract suspend fun clearProducts()

    @Query("DELETE FROM cached_categories")
    abstract suspend fun clearCategories()

    /** Clear + insert in one transaction so observers never see an empty catalogue in between. */
    @Transaction
    open suspend fun replaceProducts(products: List<CachedProduct>) {
        clearProducts()
        upsertProducts(products)
    }

    @Transaction
    open suspend fun replaceCategories(categories: List<CachedCategory>) {
        clearCategories()
        upsertCategories(categories)
    }
}

@Database(
    entities = [CachedProduct::class, CachedCategory::class],
    version = 2,
    exportSchema = true,
)
abstract class CatalogDatabase : RoomDatabase() {
    abstract fun catalogDao(): CatalogDao
}
