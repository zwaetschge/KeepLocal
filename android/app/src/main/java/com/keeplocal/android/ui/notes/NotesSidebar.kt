package com.keeplocal.android.ui.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MenuOpen
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.Divider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.model.SavedSearch
import com.keeplocal.android.ui.components.KeepLocalLogo
import com.keeplocal.android.ui.theme.LocalIsDarkTheme

// WebUI-matching pill shape: only the right side is rounded
private val SidebarItemShape =
    RoundedCornerShape(topStart = 0.dp, bottomStart = 0.dp, topEnd = 24.dp, bottomEnd = 24.dp)

// WebUI active highlight colors
private val SidebarActiveLight = Color(0xFFFEEFC3) // warm yellow
private val SidebarActiveDark = Color(0x3D8AB4F8) // blue glow, 24% alpha

/**
 * Navigation content shared by the phone modal drawer and the permanent
 * tablet/foldable sidebar, so both stay in sync with the WebUI sidebar.
 *
 * The tag list scrolls on its own while Friends/Admin/Settings stay pinned to
 * the bottom: on a 4:3 foldable the label list is long enough to push the
 * primary destinations off screen otherwise.
 */
@Composable
fun NotesSidebarContent(
    state: NotesScreenState,
    showLogo: Boolean,
    onCollapse: (() -> Unit)? = null,
    onSelectNotes: () -> Unit,
    onSelectArchive: () -> Unit,
    onSelectTrash: () -> Unit = {},
    onSelectReminders: () -> Unit = {},
    onSelectTag: (String) -> Unit,
    onNavigateToFriends: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTags: () -> Unit = {},
    onSelectToday: () -> Unit = {},
    onSelectFolder: (FolderScope) -> Unit = {},
    onToggleFolderExpanded: (String) -> Unit = {},
    onSelectSavedSearch: (SavedSearch) -> Unit = {},
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current

    Column(modifier = modifier.fillMaxHeight()) {
        if (showLogo) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 24.dp, end = 8.dp, top = 20.dp, bottom = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                KeepLocalLogo(size = 36.dp)
                Text(
                    text = stringResource(R.string.app_name),
                    style = MaterialTheme.typography.headlineSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = (-0.5).sp
                    ),
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 1,
                    modifier = Modifier.weight(1f)
                )
                if (onCollapse != null) {
                    IconButton(onClick = onCollapse) {
                        Icon(
                            Icons.Default.MenuOpen,
                            contentDescription = stringResource(R.string.cd_collapse_sidebar),
                            modifier = Modifier.rotate(180f)
                        )
                    }
                }
            }

            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 24.dp))
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Views + labels scroll; the footer below never does.
        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
        ) {
            SidebarItem(
                icon = { Icon(Icons.AutoMirrored.Filled.Notes, contentDescription = null) },
                label = stringResource(R.string.nav_notes),
                isActive = !state.showArchived && state.selectedTag == null &&
                    state.folderScope !is FolderScope.Node,
                isDark = isDark,
                onClick = onSelectNotes
            )
            SidebarItem(
                icon = { Icon(Icons.Default.Archive, contentDescription = null) },
                label = stringResource(R.string.nav_archive),
                isActive = state.showArchived,
                isDark = isDark,
                onClick = onSelectArchive
            )
            SidebarItem(
                icon = { Icon(Icons.Default.Delete, contentDescription = null) },
                label = stringResource(R.string.nav_trash),
                isActive = false,
                isDark = isDark,
                onClick = onSelectTrash
            )
            // v1.9.0 Nr. 5: everything with a reminder still ahead.
            SidebarItem(
                icon = { Icon(Icons.Default.Alarm, contentDescription = null) },
                label = stringResource(R.string.upcoming_title),
                isActive = false,
                isDark = isDark,
                onClick = onSelectReminders
            )
            // Journal (v1.10.0): today's note, created on first access.
            SidebarItem(
                icon = { Icon(Icons.Default.Today, contentDescription = null) },
                label = stringResource(R.string.nav_today),
                isActive = false,
                isDark = isDark,
                onClick = onSelectToday
            )

            // Folder tree (v1.10.0): notes with children double as folders —
            // the panel lists only those, nested, collapsible.
            val folderRoots = remember(state.noteTree) {
                state.noteTree.mapNotNull { it.asFolderOrNull() }
            }
            if (folderRoots.isNotEmpty()) {
                @Suppress("DEPRECATION")
                Divider(modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                Text(
                    text = stringResource(R.string.sidebar_folders).uppercase(),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 1.sp
                    ),
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                val activeFolderId = (state.folderScope as? FolderScope.Node)?.id
                folderRoots.forEach { folder ->
                    FolderTreeRow(
                        node = folder,
                        depth = 0,
                        activeFolderId = activeFolderId,
                        expandedIds = state.expandedFolderIds,
                        isDark = isDark,
                        onSelect = onSelectFolder,
                        onToggle = onToggleFolderExpanded
                    )
                }
            }

            // Saved searches (v1.10.0): smart folders from the account prefs.
            if (state.savedSearches.isNotEmpty()) {
                @Suppress("DEPRECATION")
                Divider(modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                Text(
                    text = stringResource(R.string.sidebar_saved_searches).uppercase(),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 1.sp
                    ),
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                state.savedSearches.forEach { search ->
                    SidebarItem(
                        icon = { Icon(Icons.Default.Search, contentDescription = null) },
                        label = search.name,
                        isActive = false,
                        isDark = isDark,
                        onClick = { onSelectSavedSearch(search) }
                    )
                }
            }

            if (state.availableTags.isNotEmpty()) {
                @Suppress("DEPRECATION")
                Divider(modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                Text(
                    text = stringResource(R.string.nav_tags).uppercase(),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.Medium,
                        letterSpacing = 1.sp
                    ),
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                state.availableTags.forEach { tag ->
                    // Palette dot (v1.10.0) instead of the label icon when the
                    // account gave this tag a color.
                    val dot = remember(tag, state.tagColors) {
                        tagChipColor(state.tagColors[tag])
                    }
                    SidebarItem(
                        icon = {
                            if (dot != null) {
                                Box(
                                    modifier = Modifier
                                        .size(11.dp)
                                        .clip(CircleShape)
                                        .background(dot)
                                )
                            } else {
                                Icon(Icons.AutoMirrored.Filled.Label, contentDescription = null)
                            }
                        },
                        label = tag,
                        isActive = state.selectedTag == tag,
                        isDark = isDark,
                        onClick = { onSelectTag(tag) }
                    )
                }
                // v1.9.0 Nr. 3: rename/merge/delete lives one tap behind the list.
                SidebarItem(
                    icon = { Icon(Icons.Default.Sell, contentDescription = null) },
                    label = stringResource(R.string.tags_title),
                    isActive = false,
                    isDark = isDark,
                    onClick = onNavigateToTags
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        @Suppress("DEPRECATION")
        Divider(modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))

        SidebarItem(
            icon = { Icon(Icons.Default.People, contentDescription = null) },
            label = stringResource(R.string.nav_friends),
            isActive = false,
            isDark = isDark,
            onClick = onNavigateToFriends
        )
        SidebarItem(
            icon = { Icon(Icons.Default.AdminPanelSettings, contentDescription = null) },
            label = stringResource(R.string.nav_admin),
            isActive = false,
            isDark = isDark,
            onClick = onNavigateToAdmin
        )
        SidebarItem(
            icon = { Icon(Icons.Default.Settings, contentDescription = null) },
            label = stringResource(R.string.nav_settings),
            isActive = false,
            isDark = isDark,
            onClick = onNavigateToSettings
        )

        Spacer(modifier = Modifier.height(16.dp))
    }
}

/**
 * Icon-only rail used on expanded windows that are not wide enough to spend
 * 264dp on labels — an unfolded foldable at 4:3, for instance, where the rail
 * hands ~180dp back to the editor pane. [onExpand] restores the full sidebar
 * (the only place the label list lives).
 */
@Composable
fun NotesSidebarRail(
    state: NotesScreenState,
    onExpand: () -> Unit,
    onSelectNotes: () -> Unit,
    onSelectArchive: () -> Unit,
    onSelectTrash: () -> Unit = {},
    onSelectReminders: () -> Unit = {},
    onNavigateToFriends: () -> Unit,
    onSelectToday: () -> Unit = {},
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTags: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    NavigationRail(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.surface,
        header = {
            Spacer(modifier = Modifier.height(8.dp))
            KeepLocalLogo(size = 32.dp)
            Spacer(modifier = Modifier.height(4.dp))
            RailItem(
                selected = false,
                icon = Icons.Default.MenuOpen,
                label = stringResource(R.string.cd_expand_sidebar),
                onClick = onExpand
            )
        }
    ) {
        RailItem(
            selected = !state.showArchived && state.selectedTag == null,
            icon = Icons.AutoMirrored.Filled.Notes,
            label = stringResource(R.string.nav_notes),
            onClick = onSelectNotes
        )
        RailItem(
            selected = state.showArchived,
            icon = Icons.Default.Archive,
            label = stringResource(R.string.nav_archive),
            onClick = onSelectArchive
        )
        RailItem(
            selected = false,
            icon = Icons.Default.Delete,
            label = stringResource(R.string.nav_trash),
            onClick = onSelectTrash
        )
        RailItem(
            selected = false,
            icon = Icons.Default.Alarm,
            label = stringResource(R.string.upcoming_title),
            onClick = onSelectReminders
        )
        RailItem(
            selected = false,
            icon = Icons.Default.Today,
            label = stringResource(R.string.nav_today),
            onClick = onSelectToday
        )
        RailItem(
            selected = false,
            icon = Icons.Default.Sell,
            label = stringResource(R.string.tags_title),
            onClick = onNavigateToTags
        )

        Spacer(modifier = Modifier.weight(1f))

        RailItem(
            selected = false,
            icon = Icons.Default.People,
            label = stringResource(R.string.nav_friends),
            onClick = onNavigateToFriends
        )
        RailItem(
            selected = false,
            icon = Icons.Default.AdminPanelSettings,
            label = stringResource(R.string.nav_admin),
            onClick = onNavigateToAdmin
        )
        RailItem(
            selected = false,
            icon = Icons.Default.Settings,
            label = stringResource(R.string.nav_settings),
            onClick = onNavigateToSettings
        )
        Spacer(modifier = Modifier.height(8.dp))
    }
}

@Composable
private fun ColumnScope.RailItem(
    selected: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit
) {
    NavigationRailItem(
        selected = selected,
        onClick = onClick,
        icon = { Icon(icon, contentDescription = label) },
        label = { Text(label, maxLines = 1) },
        alwaysShowLabel = false,
        colors = NavigationRailItemDefaults.colors(
            selectedIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
            indicatorColor = MaterialTheme.colorScheme.secondaryContainer
        )
    )
}

/**
 * A tree node narrowed to its folder descendants — leaf notes never enter the
 * panel, only notes that double as folders do.
 */
private fun NoteTreeNode.asFolderOrNull(): NoteTreeNode? =
    if (children.isEmpty()) null
    else NoteTreeNode(note, depth, children.mapNotNull { it.asFolderOrNull() })

/**
 * One row of the folder tree (v1.10.0): pill like every sidebar item,
 * indented by depth, chevron to expand sub-folders.
 */
@Composable
private fun FolderTreeRow(
    node: NoteTreeNode,
    depth: Int,
    activeFolderId: String?,
    expandedIds: Set<String>,
    isDark: Boolean,
    onSelect: (FolderScope) -> Unit,
    onToggle: (String) -> Unit
) {
    val expanded = node.note.id in expandedIds
    val active = node.note.id == activeFolderId
    val bgColor = when {
        active && isDark -> SidebarActiveDark
        active -> SidebarActiveLight
        else -> Color.Transparent
    }
    val contentColor = when {
        active && isDark -> MaterialTheme.colorScheme.primary
        active -> Color(0xFF000000).copy(alpha = 0.87f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        onClick = { onSelect(FolderScope.Node(node.note.id)) },
        shape = SidebarItemShape,
        color = bgColor,
        contentColor = contentColor,
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = 12.dp)
            .height(40.dp)
    ) {
        Row(
            modifier = Modifier.padding(start = (12 + depth * 16).dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = node.note.title.ifBlank { stringResource(R.string.editor_untitled) },
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (active) FontWeight.Medium else FontWeight.Normal
                ),
                maxLines = 1,
                modifier = Modifier.weight(1f)
            )
            if (node.children.isNotEmpty()) {
                IconButton(
                    onClick = { onToggle(node.note.id) },
                    modifier = Modifier.size(30.dp)
                ) {
                    Icon(
                        Icons.Default.ExpandMore,
                        contentDescription = stringResource(R.string.cd_toggle_folder),
                        modifier = Modifier
                            .size(20.dp)
                            .rotate(if (expanded) 0f else -90f)
                    )
                }
            }
        }
    }
    if (expanded) {
        node.children.forEach { child ->
            FolderTreeRow(
                node = child,
                depth = depth + 1,
                activeFolderId = activeFolderId,
                expandedIds = expandedIds,
                isDark = isDark,
                onSelect = onSelect,
                onToggle = onToggle
            )
        }
    }
}

// WebUI-style pill-shaped sidebar item
@Composable
private fun SidebarItem(
    icon: @Composable () -> Unit,
    label: String,
    isActive: Boolean,
    isDark: Boolean,
    onClick: () -> Unit
) {
    val bgColor = when {
        isActive && isDark -> SidebarActiveDark
        isActive -> SidebarActiveLight
        else -> Color.Transparent
    }
    val contentColor = when {
        isActive && isDark -> MaterialTheme.colorScheme.primary
        isActive -> Color(0xFF000000).copy(alpha = 0.87f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Surface(
        onClick = onClick,
        shape = SidebarItemShape,
        color = bgColor,
        contentColor = contentColor,
        modifier = Modifier
            .fillMaxWidth()
            .padding(end = 12.dp)
            .height(48.dp)
    ) {
        Row(
            modifier = Modifier.padding(start = 24.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            icon()
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = if (isActive) FontWeight.Medium else FontWeight.Normal
                ),
                maxLines = 1
            )
        }
    }
}
