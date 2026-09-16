package com.keeplocal.android

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.keeplocal.android.data.repository.MediaRepositoryImpl
import com.keeplocal.android.data.sync.BackgroundSync
import com.keeplocal.android.util.FileLogger
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent
import javax.inject.Inject

@HiltAndroidApp
class KeepLocalApplication : Application(), ImageLoaderFactory, Configuration.Provider {

    // Worker factory so @HiltWorker classes get their dependencies injected.
    @Inject lateinit var workerFactory: HiltWorkerFactory

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()


    /**
     * Entry point for the media OkHttp client. ImageLoaderFactory may be asked
     * for a loader very early; accessing the Hilt graph before onCreate would
     * throw, so the accessor degrades to the plain default loader.
     */
    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface CoilEntryPoint {
        fun mediaRepositoryImpl(): MediaRepositoryImpl
    }

    /**
     * Every Coil image in the app loads through the authenticated OkHttp
     * client (session cookies for /uploads, matching interceptor stack). Coil
     * 2 has no per-request call factory, so the app-wide loader is the hook.
     */
    override fun newImageLoader(): ImageLoader {
        val callFactory = runCatching {
            EntryPointAccessors.fromApplication(this, CoilEntryPoint::class.java)
                .mediaRepositoryImpl()
                .mediaCallFactory
        }.getOrNull()
        return ImageLoader.Builder(this)
            .apply { callFactory?.let { callFactory(it) } }
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        FileLogger.init(this)
        // Idempotent (KEEP): the worker itself checks the setting and session.
        runCatching { BackgroundSync.schedule(this) }
    }
}
