// ===================================
// Bit Builder - Bitbinder Logic
// ===================================

import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let auth, db;
let jokesData = [];
let currentEditingJokeId = null;
let allTags = new Set();
let selectedTags = new Set();
let jokesUnsubscribe = null;

// Elements
let jokesList, emptyState, searchInput, tagChips;
let editModal, deleteModal, editForm, modalCancel, cancelDelete, confirmDelete, modalClose, backBtn;

// ===================================
// Wait for Firebase to be ready
// ===================================

const initBinderApp = () => {
    if (!window.firebaseApp) {
        console.error('Firebase not initialized yet');
        setTimeout(initBinderApp, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;

    // Get DOM elements
    jokesList = document.getElementById('jokes-list');
    emptyState = document.getElementById('empty-state');
    searchInput = document.getElementById('search-input');
    tagChips = document.getElementById('tag-chips');
    editModal = document.getElementById('edit-modal');
    deleteModal = document.getElementById('delete-modal');
    editForm = document.getElementById('edit-form');
    modalCancel = document.getElementById('modal-cancel');
    cancelDelete = document.getElementById('cancel-delete');
    confirmDelete = document.getElementById('confirm-delete');
    modalClose = document.querySelector('.modal-close');
    backBtn = document.getElementById('back-btn');

    // Bind UI event listeners
    const bindUi = () => {
        searchInput.addEventListener('input', filterJokes);
        editForm.addEventListener('submit', saveJokeEdit);
        modalCancel.addEventListener('click', closeEditModal);
        modalClose.addEventListener('click', closeEditModal);
        cancelDelete.addEventListener('click', closeDeleteModal);
        confirmDelete.addEventListener('click', deleteJoke);
        backBtn.addEventListener('click', () => {
            window.location.href = 'dashboard.html';
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindUi, { once: true });
    } else {
        bindUi();
    }

    // Listen for auth state — load jokes once user is available
    onAuthStateChanged(auth, (user) => {
        if (user) {
            loadJokes();
        } else {
            // User logged out — clear data
            jokesData = [];
            allTags.clear();
            selectedTags.clear();
            if (jokesUnsubscribe) {
                jokesUnsubscribe();
                jokesUnsubscribe = null;
            }
            if (jokesList) jokesList.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
        }
    });
};

// ===================================
// Initialize
// ===================================

initBinderApp();

// ===================================
// Load Jokes from Firestore
// ===================================

function loadJokes() {
    const user = auth.currentUser;
    if (!user) return;

    // Unsubscribe from previous listener if any
    if (jokesUnsubscribe) {
        jokesUnsubscribe();
    }

    const jokesQuery = query(
        collection(db, 'jokes'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
    );

    jokesUnsubscribe = onSnapshot(jokesQuery, (snapshot) => {
        jokesData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Extract all unique tags
        allTags.clear();
        jokesData.forEach(joke => {
            if (Array.isArray(joke.tags)) {
                joke.tags.forEach(tag => allTags.add(tag));
            }
        });

        renderTagFilter();
        filterJokes();
    });
}

// ===================================
// Render Jokes
// ===================================

function filterJokes() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    let filtered = jokesData;

    // Filter by search term
    if (searchTerm) {
        filtered = filtered.filter(joke =>
            joke.content.toLowerCase().includes(searchTerm)
        );
    }

    // Filter by selected tags
    if (selectedTags.size > 0) {
        filtered = filtered.filter(joke => {
            if (!Array.isArray(joke.tags)) return false;
            return Array.from(selectedTags).some(tag => joke.tags.includes(tag));
        });
    }

    renderJokes(filtered);
}

function renderJokes(jokes) {
    jokesList.innerHTML = '';

    if (jokes.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    jokes.forEach(joke => {
        const jokeCard = createJokeCard(joke);
        jokesList.appendChild(jokeCard);
    });
}

function createJokeCard(joke) {
    const card = document.createElement('div');
    card.className = 'joke-card';

    const content = document.createElement('div');
    content.className = 'joke-content';
    content.textContent = joke.content;

    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'joke-tags';
    if (Array.isArray(joke.tags)) {
        joke.tags.forEach(tag => {
            const tagChip = document.createElement('span');
            tagChip.className = 'tag-chip';
            tagChip.textContent = tag;
            tagsDiv.appendChild(tagChip);
        });
    }

    const meta = document.createElement('div');
    meta.className = 'joke-meta';
    const createdDate = joke.createdAt?.toDate?.()?.toLocaleDateString?.() || 'Unknown';
    meta.textContent = `Added: ${createdDate}`;

    const actions = document.createElement('div');
    actions.className = 'joke-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-small btn-edit';
    editBtn.textContent = '✏️ Edit';
    editBtn.addEventListener('click', () => openEditModal(joke));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-small btn-delete';
    deleteBtn.textContent = '🗑️ Delete';
    deleteBtn.addEventListener('click', () => openDeleteModal(joke));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(content);
    card.appendChild(tagsDiv);
    card.appendChild(meta);
    card.appendChild(actions);

    return card;
}

// ===================================
// Tag Filter
// ===================================

function renderTagFilter() {
    tagChips.innerHTML = '';

    Array.from(allTags).sort().forEach(tag => {
        const chip = document.createElement('button');
        chip.className = 'tag-filter-chip';
        chip.textContent = tag;
        
        if (selectedTags.has(tag)) {
            chip.classList.add('active');
        }

        chip.addEventListener('click', () => {
            if (selectedTags.has(tag)) {
                selectedTags.delete(tag);
                chip.classList.remove('active');
            } else {
                selectedTags.add(tag);
                chip.classList.add('active');
            }
            filterJokes();
        });

        tagChips.appendChild(chip);
    });
}

// ===================================
// Edit Joke Modal
// ===================================

function openEditModal(joke) {
    currentEditingJokeId = joke.id;
    document.getElementById('edit-content').value = joke.content;
    document.getElementById('edit-tags').value = (joke.tags || []).join(', ');
    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    currentEditingJokeId = null;
    editForm.reset();
}

async function saveJokeEdit(e) {
    e.preventDefault();

    const content = document.getElementById('edit-content').value.trim();
    const tagsInput = document.getElementById('edit-tags').value.trim();
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);

    if (!content || tags.length === 0) {
        alert('Please fill in all fields');
        return;
    }

    try {
        const jokeRef = doc(db, 'jokes', currentEditingJokeId);
        await updateDoc(jokeRef, {
            content,
            tags,
            updatedAt: serverTimestamp()
        });

        closeEditModal();
    } catch (error) {
        console.error('Error updating joke:', error);
        alert('Error updating joke: ' + error.message);
    }
}

// ===================================
// Delete Joke Modal
// ===================================

function openDeleteModal(joke) {
    currentEditingJokeId = joke.id;
    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteModal.classList.add('hidden');
    currentEditingJokeId = null;
}

async function deleteJoke() {
    if (!currentEditingJokeId) return;

    try {
        await deleteDoc(doc(db, 'jokes', currentEditingJokeId));
        closeDeleteModal();
    } catch (error) {
        console.error('Error deleting joke:', error);
        alert('Error deleting joke: ' + error.message);
    }
}
