package com.keeplocal.android.widget

import android.content.Context
import android.content.Intent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.*
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.layout.*
import androidx.glance.text.*
import androidx.glance.unit.ColorProvider
import com.keeplocal.android.R
import com.keeplocal.android.ui.MainActivity
import com.keeplocal.android.util.IncomingIntents

class QuickCaptureWidget:GlanceAppWidget() {
    override suspend fun provideGlance(context:Context,id:GlanceId) {
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(Color(0xfff4f1e9)).cornerRadius(16.dp).padding(12.dp)) {
                Text("KeepLocal",style=TextStyle(color=ColorProvider(Color(0xff202124)),fontWeight=FontWeight.Bold,fontSize=16.sp))
                Row(GlanceModifier.fillMaxWidth().padding(top=8.dp)) {
                    listOf("text" to R.string.capture_text,"list" to R.string.capture_list,"image" to R.string.capture_image,"drawing" to R.string.capture_drawing).forEach { (kind,label) ->
                        Text(context.getString(label),style=TextStyle(color=ColorProvider(Color(0xff202124)),fontSize=13.sp),modifier=GlanceModifier.defaultWeight().padding(8.dp).clickable(actionStartActivity(Intent(context,MainActivity::class.java).putExtra(IncomingIntents.EXTRA_CAPTURE_KIND,kind))))
                    }
                }
            }
        }
    }
}
class QuickCaptureWidgetReceiver:GlanceAppWidgetReceiver() {
    override val glanceAppWidget:GlanceAppWidget=QuickCaptureWidget()
}
