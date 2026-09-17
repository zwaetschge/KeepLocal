package com.keeplocal.android.di

import com.keeplocal.android.BuildConfig
import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.NullableString
import com.keeplocal.android.data.api.NullableStringAdapter
import com.keeplocal.android.data.api.SessionCookieJar
import com.keeplocal.android.data.api.interceptor.AuthInterceptor
import com.keeplocal.android.data.api.interceptor.DynamicBaseUrlInterceptor
import com.keeplocal.android.data.local.CredentialsStore
import com.keeplocal.android.data.local.EncryptedCredentialsStore
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideCredentialsStore(impl: EncryptedCredentialsStore): CredentialsStore = impl

    @Provides
    @Singleton
    fun provideMoshi(): Moshi = Moshi.Builder()
        // Writes wrapped nullable fields as explicit JSON null (reminder delete).
        // A JsonAdapter instance must be registered type-keyed — add(Object)
        // would look for @ToJson/@FromJson methods and crash at DI time.
        .add(NullableString::class.java, NullableStringAdapter)
        .add(KotlinJsonAdapterFactory())
        .build()

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        dynamicBaseUrlInterceptor: DynamicBaseUrlInterceptor,
        cookieJar: SessionCookieJar
    ): OkHttpClient {
        val logging = HttpLoggingInterceptor().apply {
            redactHeader("Authorization")
            redactHeader("Cookie")
            redactHeader("Set-Cookie")
            redactHeader("X-CSRF-Token")
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        return OkHttpClient.Builder()
            // Required for the API's double-submit CSRF cookie; see SessionCookieJar.
            .cookieJar(cookieJar)
            .followRedirects(false)
            .followSslRedirects(false)
            .addInterceptor(dynamicBaseUrlInterceptor)
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        moshi: Moshi
    ): Retrofit {
        return Retrofit.Builder()
            .baseUrl("http://localhost/")
            .client(okHttpClient)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .build()
    }

    @Provides
    @Singleton
    fun provideKeepLocalApi(retrofit: Retrofit): KeepLocalApi =
        retrofit.create(KeepLocalApi::class.java)
}
