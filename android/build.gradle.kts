plugins {
    id("com.android.application") version "8.2.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
    id("com.google.dagger.hilt.android") version "2.50" apply false
    id("com.google.devtools.ksp") version "1.9.22-1.0.17" apply false
}

// Mirror task output into build-output.log. The builder runs Gradle inside its
// own container and only streams the console back over a socket, so this file is
// the only way to read compiler diagnostics from the workspace.
val buildOutputLog: java.io.File = File(rootDir, "build-output.log")
buildOutputLog.writeText("")
gradle.taskGraph.whenReady {
    allTasks.forEach { task ->
        task.logging.addStandardOutputListener { message ->
            buildOutputLog.appendText(message.toString())
        }
        task.logging.addStandardErrorListener { message ->
            buildOutputLog.appendText(message.toString())
        }
    }
}
