package com.keeplocal.android.ui.friends

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.util.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendsScreen(
    onNavigateBack: () -> Unit,
    viewModel: FriendsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.friends_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // Search
            item {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = viewModel::onSearchQueryChanged,
                    placeholder = { Text(stringResource(R.string.friends_search)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) }
                )
            }

            if (uiState.searchResults.isNotEmpty()) {
                item {
                    Text(
                        stringResource(R.string.cd_search),
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                items(uiState.searchResults, key = { "search_${it.id}" }) { user ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Person, contentDescription = null)
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(user.username, modifier = Modifier.weight(1f))
                            FilledTonalButton(onClick = { viewModel.sendRequest(user.username) }) {
                                Text(stringResource(R.string.friends_send_request))
                            }
                        }
                    }
                }
            }

            // Pending requests
            if (uiState.requests.isNotEmpty()) {
                item {
                    Text(
                        stringResource(R.string.friends_pending),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(top = 16.dp)
                    )
                }
                items(uiState.requests, key = { "req_${it.id}" }) { request ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.PersonAdd, contentDescription = null)
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    if (request.isIncoming) request.fromUsername else request.toUsername,
                                    style = MaterialTheme.typography.bodyLarge
                                )
                                Text(
                                    if (request.isIncoming) stringResource(R.string.friends_incoming)
                                    else stringResource(R.string.friends_outgoing),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (request.isIncoming) {
                                IconButton(onClick = { viewModel.acceptRequest(request.id) }) {
                                    Icon(Icons.Default.Check, contentDescription = stringResource(R.string.friends_accept))
                                }
                                IconButton(onClick = { viewModel.rejectRequest(request.id) }) {
                                    Icon(Icons.Default.Close, contentDescription = stringResource(R.string.friends_reject))
                                }
                            }
                        }
                    }
                }
            }

            // Friends list
            item {
                Text(
                    stringResource(R.string.friends_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 16.dp)
                )
            }

            when (val friends = uiState.friends) {
                is UiState.Loading -> {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator()
                        }
                    }
                }
                is UiState.Empty -> {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            Text(stringResource(R.string.friends_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                is UiState.Error -> {
                    item {
                        Column(modifier = Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(friends.message, color = MaterialTheme.colorScheme.error)
                            Spacer(modifier = Modifier.height(8.dp))
                            FilledTonalButton(onClick = viewModel::loadFriends) { Text(stringResource(R.string.retry)) }
                        }
                    }
                }
                is UiState.Success -> {
                    items(friends.data, key = { "friend_${it.id}" }) { friend ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Default.Person, contentDescription = null)
                                Spacer(modifier = Modifier.width(12.dp))
                                Text(friend.username, modifier = Modifier.weight(1f))
                                IconButton(onClick = { viewModel.removeFriend(friend.id) }) {
                                    Icon(Icons.Default.PersonRemove, contentDescription = stringResource(R.string.friends_remove))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
