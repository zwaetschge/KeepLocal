package com.keeplocal.android.domain.model

fun normalizeChecklist(items:List<TodoItem>)=items.mapIndexed {i,item->item.copy(position=i,indent=if(i==0)0 else item.indent.coerceIn(0,1))}
fun moveChecklist(items:List<TodoItem>,index:Int,direction:Int):List<TodoItem> {
    if(index !in items.indices)return items
    var end=index+1
    if(items[index].indent==0)while(end<items.size && items[end].indent==1)end++
    var target=if(direction<0)index-1 else end
    if(target !in items.indices)return items
    if(items[index].indent==0){
        if(direction<0)while(target>0 && items[target].indent==1)target--
        else {target++;while(target<items.size && items[target].indent==1)target++}
    }
    val next=items.toMutableList();val group=items.subList(index,end).toList()
    repeat(end-index){next.removeAt(index)}
    next.addAll(if(target>index)target-group.size else target,group)
    return normalizeChecklist(next)
}
fun toggleChecklist(items:List<TodoItem>,index:Int):List<TodoItem>{
    if(index !in items.indices)return items
    var end=index+1;if(items[index].indent==0)while(end<items.size && items[end].indent==1)end++
    return items.mapIndexed {i,item->if(i in index until end)item.copy(isCompleted=!items[index].isCompleted) else item}
}
