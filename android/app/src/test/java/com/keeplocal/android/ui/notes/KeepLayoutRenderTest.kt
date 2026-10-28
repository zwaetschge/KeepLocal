package com.keeplocal.android.ui.notes

import android.app.Application
import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.keeplocal.android.domain.model.*
import com.keeplocal.android.ui.theme.KeepLocalTheme
import com.keeplocal.android.ui.theme.ThemeMode
import com.keeplocal.android.util.UiState
import io.mockk.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Instant

/** Real Compose/Android rendering on the JVM; physical IME/insets still need device QA. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "en-rUS-w390dp-h844dp-420dpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class KeepLayoutRenderTest {
    @get:Rule val compose = createComposeRule()
    private val themes = listOf(ThemeMode.LIGHT, ThemeMode.DARK, ThemeMode.OLED, ThemeMode.E_INK, ThemeMode.DOODLE)

    private fun screenshot(name: String) {
        compose.waitForIdle()
        compose.runOnIdle {
            // Capture every Android window, including Popup/ModalBottomSheet.
            val bitmap = androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().uiAutomation.takeScreenshot()
                ?: error("Native Android renderer returned no screenshot")
            val output = File("build/keep-layout/$name.png").apply { parentFile?.mkdirs() }
            output.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
    }

    private fun note(id: String, title: String, content: String, pinned: Boolean = false) = Note(
        id = id, title = title, content = content, color = NoteColor.DEFAULT, isPinned = pinned,
        isArchived = false, isTodoList = false, todoItems = emptyList(), tags = emptyList(),
        sharedWith = emptyList(), owner = "me", position = 0,
        createdAt = Instant.EPOCH, updatedAt = Instant.EPOCH
    )

    @Test fun overviewHasOneSearchTwoColumnsAndFullNoteListMode() {
        val state = MutableStateFlow(NotesScreenState(notes = UiState.Success(listOf(
            note("1", "Weekend", "Train tickets\nFind a quiet spot by the lake\nPack a book", true),
            note("2", "Shopping", "Tomatoes\nBread\nCoffee\nOlive oil").copy(color = NoteColor.YELLOW),
            note("3", "An idea", "Make room for small things. A notebook, a walk, a conversation.").copy(color = NoteColor.BLUE),
            note("4", "Read next", "The creative act\nA field guide to getting lost\nWays of seeing").copy(tags = listOf("Books"))
        ))))
        val vm = mockk<NotesViewModel>(relaxed = true)
        every { vm.uiState } returns state
        every { vm.reloginEvent } returns MutableSharedFlow()
        every { vm.openNoteEvent } returns MutableSharedFlow()
        var theme by mutableStateOf(ThemeMode.LIGHT)
        compose.setContent {
            KeepLocalTheme(themeMode = theme) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    NotesScreen({ _, _ -> }, {}, {}, {}, viewModel = vm)
                }
            }
        }
        themes.forEach { mode ->
            compose.runOnIdle { theme = mode }
            compose.onNodeWithText("Search notes…").assertIsDisplayed()
            compose.onAllNodesWithText("Search notes…").assertCountEquals(1)
            compose.onNodeWithText("An idea").assertIsDisplayed()
            val left = compose.onNodeWithText("Shopping").fetchSemanticsNode().boundsInRoot.left
            val right = compose.onNodeWithText("An idea").fetchSemanticsNode().boundsInRoot.left
            assertTrue("Phone needs two columns", right > left + 50)
            screenshot("overview-${mode.key}")
        }
        compose.onNodeWithContentDescription("Switch to list view").performClick()
        verify { vm.toggleViewMode() }
        compose.runOnIdle { state.value = state.value.copy(viewMode = NoteViewMode.LIST) }
        compose.onNodeWithText("The creative act\nA field guide to getting lost\nWays of seeing").assertExists()
        screenshot("overview-list")
        compose.onNodeWithText("Search notes…").performClick()
        compose.onNodeWithContentDescription("Filters").assertIsDisplayed()
        screenshot("search")
    }

    @Test fun editorKeepsToolsInMenusAndCanArchive() = editorScenario()

    @Test @Config(qualifiers = "en-rUS-w320dp-h740dp-420dpi")
    fun narrowEditorStillExposesPrimaryActions() {
        org.robolectric.RuntimeEnvironment.setFontScale(1.3f)
        editorScenario("narrow-")
    }

    private fun editorScenario(prefix: String = "") {
        val state = MutableStateFlow(NoteEditorState(id = "1", isNewNote = false,
            title = "A little breathing room", content = "Ideas belong here.\n\nThe tools can wait until you need them.",
            tags = listOf("Ideas")))
        val vm = mockk<NoteEditorViewModel>(relaxed = true)
        every { vm.uiState } returns state
        every { vm.navigateBack } returns MutableSharedFlow()
        var theme by mutableStateOf(ThemeMode.LIGHT)
        compose.setContent {
            KeepLocalTheme(themeMode = theme) { NoteEditorContent(vm, {}, false) }
        }
        themes.forEach { mode ->
            compose.runOnIdle { theme = mode }
            compose.onNodeWithContentDescription("Go back").assertIsDisplayed()
            compose.onNodeWithContentDescription("Pin note").assertIsDisplayed()
            compose.onNodeWithContentDescription("Archive note").assertIsDisplayed()
            compose.onNodeWithContentDescription("Formatting").assertIsDisplayed()
            compose.onNodeWithText("Add tag").assertDoesNotExist()
            screenshot("${prefix}editor-${mode.key}")
        }
        compose.onNodeWithContentDescription("Formatting").performClick()
        compose.onNodeWithText("H1").assertIsDisplayed()
        screenshot("${prefix}editor-formatting")
        compose.onNodeWithContentDescription("Formatting").performClick()
        compose.onNodeWithContentDescription("Add to note").performClick()
        compose.onNodeWithText("Add image").assertIsDisplayed()
        screenshot("${prefix}editor-add-menu")
        compose.onNodeWithText("Todo list").performClick()
        verify { vm.toggleTodoList() }
        compose.onNodeWithContentDescription("Archive note").performClick()
        verify(exactly = 1) { vm.archiveAndClose() }
        compose.runOnIdle { state.value = state.value.copy(isTodoList = true, todoItems = listOf(
            TodoItem("a", "A clear next step", false, 0), TodoItem("b", "Already done", true, 1)
        )) }
        compose.onNodeWithText("A clear next step").assertIsDisplayed()
        compose.onNodeWithText("List settings").assertDoesNotExist()
        screenshot("${prefix}editor-checklist")
        compose.onNodeWithContentDescription("More actions").performClick()
        compose.onNodeWithText("List settings").assertIsDisplayed()
        screenshot("${prefix}editor-more")
        compose.onNodeWithText("Labels").performClick()
        compose.onNodeWithText("Add tag").assertIsDisplayed()
        screenshot("${prefix}editor-labels")
    }
}
