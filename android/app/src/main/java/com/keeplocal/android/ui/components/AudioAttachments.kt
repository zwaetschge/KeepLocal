package com.keeplocal.android.ui.components

import android.media.MediaPlayer
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.NoteFile
import com.keeplocal.android.domain.repository.MediaRepository
import kotlinx.coroutines.launch

@Composable
fun AudioAttachments(files:List<NoteFile>,repository:MediaRepository,onError:(String)->Unit,onDelete:(NoteFile)->Unit){
 files.forEach { file ->
  var player by remember(file.filename){mutableStateOf<MediaPlayer?>(null)}
  var playing by remember(file.filename){mutableStateOf(false)}
  var busy by remember(file.filename){mutableStateOf(false)}
  val scope=rememberCoroutineScope()
  DisposableEffect(file.filename){onDispose{player?.release()}}
  Row {
  TextButton(modifier=Modifier.weight(1f),enabled=!busy,onClick={
   if(playing){player?.pause();playing=false}
   else if(player!=null){player?.start();playing=true}
   else {busy=true;scope.launch{
    val result=repository.downloadFileToCache(file);val local=result.getOrNull()
    if(local!=null)try{val media=MediaPlayer();media.setDataSource(local.absolutePath);media.setOnCompletionListener{playing=false};media.prepare();player=media;media.start();playing=true}catch(e:Exception){onError(e.message ?: "Audio")}
    else onError((result as? com.keeplocal.android.util.Result.Error)?.message ?: "Audio")
    busy=false
   }}
  }){if(busy)CircularProgressIndicator(Modifier.size(18.dp)) else Text(stringResource(if(playing)R.string.audio_pause else R.string.audio_play));Spacer(Modifier.width(8.dp));Text(file.originalName ?: file.filename)}
  TextButton(onClick={player?.stop();playing=false;onDelete(file)}){Text(stringResource(R.string.delete))}
  }
 }
}
