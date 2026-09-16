# Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Moshi
-keep class com.squareup.moshi.** { *; }
-keep @com.squareup.moshi.JsonQualifier interface *
-keepclassmembers @com.squareup.moshi.JsonClass class * extends java.lang.Enum {
    <fields>;
}
-keepnames @com.squareup.moshi.JsonClass class *
-keepclassmembers class * {
    @com.squareup.moshi.FromJson <methods>;
    @com.squareup.moshi.ToJson <methods>;
}

# Room
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *

# Keep data classes used with Moshi
-keep class com.keeplocal.android.data.api.dto.** { *; }
-keep class com.keeplocal.android.domain.model.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Google Tink (used by EncryptedSharedPreferences)
-dontwarn com.google.errorprone.annotations.**
