package com.keeplocal.android.ui.components

import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color

fun Modifier.noteBackground(pattern:String,ink:Color)=drawBehind {
 val step=28.dp.toPx();val line=ink.copy(alpha=0.09f)
 when(pattern){
  "lines","grid"->{var y=step;while(y<size.height){drawLine(line,Offset(0f,y),Offset(size.width,y));y+=step};if(pattern=="grid"){var x=step;while(x<size.width){drawLine(line,Offset(x,0f),Offset(x,size.height));x+=step}}}
  "dots","leaves","sand"->{var y=step/2;while(y<size.height){var x=step/2;while(x<size.width){drawCircle(line,if(pattern=="leaves")6.dp.toPx() else 1.dp.toPx(),Offset(x,y));x+=step};y+=step}}
 }
}
