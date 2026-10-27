package com.keeplocal.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.*

@Composable
fun NoteDrawingEditor(value: NoteDrawing,onChange:(NoteDrawing)->Unit,onClose:()->Unit,images:List<NoteImage> = emptyList()) {
    var color by remember {mutableStateOf("#202124")}
    var eraser by remember {mutableStateOf(false)}
    var active by remember {mutableStateOf<List<List<Float>>>(emptyList())}
    val latest by rememberUpdatedState(value)
    AlertDialog(onDismissRequest=onClose,confirmButton={TextButton(onClick=onClose){Text(stringResource(R.string.cd_close))}},
        title={Text(stringResource(R.string.capture_drawing))},
        text={Column {
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                listOf("#202124","#b3261e","#185abc","#137333").forEach { c -> TextButton(onClick={color=c;eraser=false}){Text("●",color=Color(android.graphics.Color.parseColor(c)))} }
            }
            Row {
                TextButton(onClick={eraser=!eraser}){Text(stringResource(R.string.drawing_eraser))}
                TextButton(onClick={onChange(value.copy(strokes=value.strokes.dropLast(1)))},enabled=value.strokes.isNotEmpty()){Text(stringResource(R.string.drawing_undo))}
            }
            if(images.isNotEmpty())Row(Modifier.horizontalScroll(rememberScrollState())) {
                TextButton(onClick={onChange(value.copy(imageFilename=null))}){Text(stringResource(R.string.drawing_blank))}
                images.forEachIndexed {i,image->TextButton(onClick={onChange(value.copy(imageFilename=image.filename))}){Text("${stringResource(R.string.capture_image)} ${i+1}")}}
            }
            Box(Modifier.fillMaxWidth().aspectRatio(value.width.toFloat()/value.height)) {
            val selected=images.find{it.filename==value.imageFilename}
            if(selected!=null)coil.compose.AsyncImage(model=rememberMediaImageModel(selected.url),contentDescription=null,contentScale=androidx.compose.ui.layout.ContentScale.Fit,modifier=Modifier.matchParentSize())
            Canvas(Modifier.fillMaxWidth().aspectRatio(value.width.toFloat()/value.height).pointerInput(color,eraser) {
                fun point(p:Offset)=listOf((p.x/size.width*latest.width).coerceIn(0f,latest.width.toFloat()),(p.y/size.height*latest.height).coerceIn(0f,latest.height.toFloat()))
                detectDragGestures(onDragStart={p->
                    val first=point(p)
                    if(eraser){val idx=latest.strokes.indexOfLast {s->s.points.any {q->kotlin.math.abs(q[0]-first[0])<25 && kotlin.math.abs(q[1]-first[1])<25}};if(idx>=0)onChange(latest.copy(strokes=latest.strokes.filterIndexed {i,_->i!=idx}))}
                    else active=listOf(first)
                },onDragEnd={
                    if(active.isNotEmpty() && latest.strokes.size<500)onChange(latest.copy(strokes=latest.strokes+DrawingStroke(color,3f,active)))
                    active=emptyList()
                },onDragCancel={active=emptyList()}) {change,_->
                    change.consume()
                    if(!eraser && active.size+latest.strokes.sumOf {it.points.size}<20000)active=active+listOf(point(change.position))
                }
            }) {
                if(value.imageFilename==null)drawRect(Color(0xfffafafa))
                (value.strokes+if(active.isEmpty())emptyList() else listOf(DrawingStroke(color,3f,active))).forEach {s->
                    val ink=Color(android.graphics.Color.parseColor(s.color))
                    s.points.zipWithNext().forEach {(a,b)->drawLine(ink,Offset(a[0]/value.width*size.width,a[1]/value.height*size.height),Offset(b[0]/value.width*size.width,b[1]/value.height*size.height),s.width*size.width/value.width,StrokeCap.Round)}
                }
            }
            }
        }})
}

@Composable
fun NoteDrawingPreview(value:NoteDrawing,modifier:Modifier=Modifier,images:List<NoteImage> = emptyList()) {
    Box(modifier.fillMaxWidth().aspectRatio(value.width.toFloat()/value.height)) {
    images.find{it.filename==value.imageFilename}?.let {image->coil.compose.AsyncImage(model=rememberMediaImageModel(image.url),contentDescription=null,contentScale=androidx.compose.ui.layout.ContentScale.Fit,modifier=Modifier.matchParentSize())}
    Canvas(Modifier.matchParentSize()) {
        value.strokes.forEach {s->s.points.zipWithNext().forEach {(a,b)->drawLine(Color(android.graphics.Color.parseColor(s.color)),Offset(a[0]/value.width*size.width,a[1]/value.height*size.height),Offset(b[0]/value.width*size.width,b[1]/value.height*size.height),s.width*size.width/value.width,StrokeCap.Round)}}
    }
}
}
