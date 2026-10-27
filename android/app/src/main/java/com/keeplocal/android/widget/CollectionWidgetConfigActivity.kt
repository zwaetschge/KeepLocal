package com.keeplocal.android.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.glance.appwidget.AppWidgetId
import androidx.lifecycle.lifecycleScope
import com.keeplocal.android.R
import com.keeplocal.android.data.local.entity.toDomain
import dagger.hilt.android.EntryPointAccessors
import kotlinx.coroutines.launch

class CollectionWidgetConfigActivity:ComponentActivity() {
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val widgetId=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID)
        if(widgetId==AppWidgetManager.INVALID_APPWIDGET_ID){finish();return}
        lifecycleScope.launch {
            val entry=EntryPointAccessors.fromApplication(applicationContext,WidgetEntryPoint::class.java)
            val tags=entry.noteDao().getAllLiveNotesSync().map {it.toDomain()}.flatMap {it.tags}.distinct().sorted()
            setContent {
                MaterialTheme {
                    Surface {
                        LazyColumn {
                            item {Text(getString(R.string.collection_widget_name),style=MaterialTheme.typography.headlineSmall)}
                            val choices=listOf("pinned" to getString(R.string.widget_pinned_name),"all" to getString(R.string.widget_all_notes))+tags.map {"tag:$it" to it}
                            choices.forEach { (filter,label) -> item { ListItem(headlineContent={Text(label)},modifier=Modifier.fillMaxWidth().clickable {
                                collectionWidgetPrefs(this@CollectionWidgetConfigActivity).edit().putString("filter_$widgetId",filter).apply()
                                lifecycleScope.launch {
                                    PinnedNotesWidget().update(applicationContext,AppWidgetId(widgetId))
                                    setResult(RESULT_OK,Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widgetId));finish()
                                }
                            }) } }
                        }
                    }
                }
            }
        }
    }
}
fun collectionWidgetPrefs(context:Context)=context.getSharedPreferences("collection_widget",Context.MODE_PRIVATE)
