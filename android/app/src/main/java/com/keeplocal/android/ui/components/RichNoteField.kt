package com.keeplocal.android.ui.components

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keeplocal.android.domain.model.TextMark

fun richNoteText(text: String, marks: List<TextMark>): AnnotatedString = buildAnnotatedString {
    append(text)
    marks.filter { it.start >= 0 && it.end > it.start && it.end <= text.length }.forEach { mark ->
        val style = when(mark.type) {
            "bold" -> SpanStyle(fontWeight=FontWeight.Bold)
            "italic" -> SpanStyle(fontStyle=FontStyle.Italic)
            "underline" -> SpanStyle(textDecoration=TextDecoration.Underline)
            "h1" -> SpanStyle(fontWeight=FontWeight.SemiBold,fontSize=24.sp)
            "h2" -> SpanStyle(fontWeight=FontWeight.SemiBold,fontSize=20.sp)
            else -> SpanStyle()
        }
        addStyle(style,mark.start,mark.end)
    }
}

fun shiftTextMarks(marks: List<TextMark>,before: String,after: String): List<TextMark> {
    var start=0
    while(start<before.length && start<after.length && before[start]==after[start])start++
    var tail=0
    while(tail<before.length-start && tail<after.length-start && before[before.lastIndex-tail]==after[after.lastIndex-tail])tail++
    val end=before.length-tail
    val delta=after.length-before.length
    return marks.map { m -> m.copy(
        start=if(m.start<=start)m.start else if(m.start>=end)m.start+delta else start,
        end=if(m.end<=start)m.end else if(m.end>=end)m.end+delta else after.length-tail
    ) }.filter { it.start>=0 && it.end>it.start && it.end<=after.length }
}

@Composable
fun RichNoteField(text: String, marks: List<TextMark>, onChange:(String,List<TextMark>)->Unit, modifier:Modifier=Modifier) {
    var field by remember { mutableStateOf(TextFieldValue(text)) }
    LaunchedEffect(text) { if(field.text!=text)field=TextFieldValue(text,TextRange(text.length)) }
    fun format(type:String) {
        var start=field.selection.min
        var end=field.selection.max
        if(type=="h1" || type=="h2") {
            start=text.lastIndexOf('\n',(start-1).coerceAtLeast(0)).let { if(it<0)0 else it+1 }
            end=text.indexOf('\n',end).let { if(it<0)text.length else it }
        }
        if(start==end)return
        val remove=type=="clear" || marks.any {it.type==type && it.start<=start && it.end>=end}
        val next=marks.flatMap { m ->
            if((type=="clear" || m.type==type || (type.startsWith("h") && m.type.startsWith("h"))) && m.start<end && m.end>start) listOfNotNull(
                m.copy(end=start).takeIf {it.end>it.start},m.copy(start=end).takeIf {it.end>it.start}
            ) else listOf(m)
        }.toMutableList()
        if(!remove)next.add(TextMark(type,start,end))
        onChange(text,next)
    }
    Column(modifier) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            listOf("H1" to "h1","H2" to "h2","B" to "bold","I" to "italic","U" to "underline","Aa" to "clear").forEach { (label,type) ->
                TextButton(onClick={format(type)},enabled=field.selection.min!=field.selection.max || type.startsWith("h")) {Text(label)}
            }
        }
        TextField(value=field,onValueChange={value->if(value.text.length<=10000){val next=shiftTextMarks(marks,field.text,value.text);field=value;onChange(value.text,next)}},
            modifier=Modifier.fillMaxWidth().weight(1f),
            visualTransformation=VisualTransformation { value -> TransformedText(richNoteText(value.text,marks),OffsetMapping.Identity) },
            colors=TextFieldDefaults.colors(focusedContainerColor=Color.Transparent,unfocusedContainerColor=Color.Transparent,focusedIndicatorColor=Color.Transparent,unfocusedIndicatorColor=Color.Transparent),
            textStyle=MaterialTheme.typography.bodyLarge)
    }
}
