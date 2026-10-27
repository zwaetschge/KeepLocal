package com.keeplocal.android.util
import com.keeplocal.android.domain.model.*
import com.keeplocal.android.ui.components.shiftTextMarks
import com.squareup.moshi.Moshi
import org.junit.Assert.*
import org.junit.Test
class KeepParityTest {
 @Test fun checklistMovesGroupAndChecksChildren(){
  val items=listOf(TodoItem("a","Parent",false,0),TodoItem("b","Child",false,1,1),TodoItem("c","Next",false,2))
  assertEquals(listOf("c","a","b"),moveChecklist(items,0,1).map{it.id})
  assertEquals(listOf(true,true,false),toggleChecklist(items,0).map{it.isCompleted})
 }
 @Test fun sharedRepresentationRoundTripsWithoutHtml(){
  val adapter=Moshi.Builder().build().adapter(NoteFeatures::class.java)
  val data=NoteFeatures(format="rich",marks=listOf(TextMark("bold",3,7)),background="grid",drawing=NoteDrawing(strokes=listOf(DrawingStroke(points=listOf(listOf(1f,2f),listOf(3f,4f))))))
  assertEquals(data,adapter.fromJson(adapter.toJson(data)))
 }
 @Test fun utf16MarksShiftAcrossEmoji(){assertEquals(listOf(TextMark("bold",6,10)),shiftTextMarks(listOf(TextMark("bold",3,7)),"👋 bold","Hi 👋 bold"))}
 @Test fun markdownBulkImportKeepsPackedMetadata(){
  val raw="---\ntitle: 'Original'\nkeepLocalData: eyJmZWF0dXJlcyI6e319\n---\nHello"
  val parsed=MarkdownNoteParser.parse(listOf(MarkdownNoteParser.FileEntry("note.md",raw))) as MarkdownNoteParser.Result.Success
  assertEquals(raw,com.keeplocal.android.data.api.dto.buildMarkdownImportItems(parsed.import).single().content)
 }
 @Test fun populatedOwnerAndParticipantIdsSurviveTheWire(){
  val moshi=Moshi.Builder().build()
  val note=moshi.adapter(com.keeplocal.android.data.api.dto.NoteDto::class.java).fromJson("""{"_id":"note","userId":{"_id":"owner","username":"Owner"},"sharedWith":[{"_id":"friend","username":"Friend"}]}""")!!
  assertEquals("owner",note.resolvedOwnerId())
  assertEquals("friend",note.sharedWith!!.single().mongoId)
 }
}
