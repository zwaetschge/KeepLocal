package com.keeplocal.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.*

@Composable
fun ChecklistEditor(items:List<TodoItem>,options:ChecklistOptions,onOptions:(ChecklistOptions)->Unit,onText:(Int,String)->Unit,onToggle:(Int)->Unit,onMove:(Int,Int)->Unit,onIndent:(Int)->Unit,onDelete:(Int)->Unit,onAdd:()->Unit,onCleanup:()->Unit,modifier:Modifier=Modifier){
    var settings by remember{mutableStateOf(false)}
    var parentCompleted=false
    val indexed=items.mapIndexed {index,item->if(item.indent==0)parentCompleted=item.isCompleted;Triple(index,item,options.checkedToBottom && (item.isCompleted || (item.indent==1 && parentCompleted)))}
    LazyColumn(modifier){
        items(indexed.filter{!it.third},key={it.second.id}){(index,item,_)->ChecklistRow(item,index,items.size,onText,onToggle,onMove,onIndent,onDelete,onAdd)}
        item {TextButton(onClick=onAdd){Text(stringResource(R.string.editor_add_todo_item))}}
        val done=indexed.filter{it.third}
        if(done.isNotEmpty()){
            item{TextButton(onClick={onOptions(options.copy(collapseCompleted=!options.collapseCompleted))}){Text("${if(options.collapseCompleted)"▸" else "▾"} ${done.size} ${stringResource(R.string.list_completed)}")}}
            if(!options.collapseCompleted)items(done,key={it.second.id}){(index,item,_)->ChecklistRow(item,index,items.size,onText,onToggle,onMove,onIndent,onDelete,onAdd)}
        }
        item {
            TextButton(onClick={settings=!settings}){Text(stringResource(R.string.list_settings))}
            if(settings)Column{
                Row(verticalAlignment=Alignment.CenterVertically){Switch(checked=options.checkedToBottom,onCheckedChange={onOptions(options.copy(checkedToBottom=it))});Text(stringResource(R.string.list_checked_bottom))}
                Row(verticalAlignment=Alignment.CenterVertically){Switch(checked=options.addToTop,onCheckedChange={onOptions(options.copy(addToTop=it))});Text(stringResource(R.string.list_add_top))}
                TextButton(onClick=onCleanup){Text(stringResource(R.string.checklist_cleanup))}
            }
        }
    }
}
@Composable
private fun ChecklistRow(item:TodoItem,index:Int,count:Int,onText:(Int,String)->Unit,onToggle:(Int)->Unit,onMove:(Int,Int)->Unit,onIndent:(Int)->Unit,onDelete:(Int)->Unit,onAdd:()->Unit){
    var menu by remember(item.id){mutableStateOf(false)}
    Row(Modifier.fillMaxWidth().padding(start=(item.indent*24).dp),verticalAlignment=Alignment.CenterVertically){
        Checkbox(item.isCompleted,{onToggle(index)})
        TextField(item.text,{onText(index,it)},Modifier.weight(1f),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Next),keyboardActions=KeyboardActions(onNext={onAdd()}),colors=TextFieldDefaults.colors(focusedContainerColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedContainerColor=androidx.compose.ui.graphics.Color.Transparent))
        Box{
            IconButton(onClick={menu=true}){Icon(Icons.Default.MoreVert,stringResource(R.string.list_item_actions))}
            DropdownMenu(menu,{menu=false}){
                DropdownMenuItem(text={Text(stringResource(R.string.list_move_up))},enabled=index>0,onClick={onMove(index,-1);menu=false})
                DropdownMenuItem(text={Text(stringResource(R.string.list_move_down))},enabled=index<count-1,onClick={onMove(index,1);menu=false})
                DropdownMenuItem(text={Text(stringResource(if(item.indent==0)R.string.list_indent else R.string.list_outdent))},enabled=index>0,onClick={onIndent(index);menu=false})
                DropdownMenuItem(text={Text(stringResource(R.string.delete))},onClick={onDelete(index);menu=false})
            }
        }
    }
}
