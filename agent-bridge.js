// ===================================
// Agent Bridge — connects ElevenLabs widget to Firebase
//
// Listens for tool-call events from the widget and
// executes them against Firestore using the logged-in user's auth.
// ===================================

import {
    collection,
    addDoc,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let auth, db;
let currentUser = null;

// ===================================
// Wait for Firebase to be ready, then wire up the widget
// ===================================

function init() {
    if (!window.firebaseApp) {
        setTimeout(init, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;

    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[agent-bridge] User authenticated:', user.uid);
            wireWidget();
        }
    });
}

// ===================================
// Connect to the ElevenLabs widget
// ===================================

function wireWidget() {
    // The widget may load after this script — poll until it exists
    const widget = document.querySelector('elevenlabs-convai');
    if (!widget) {
        setTimeout(wireWidget, 200);
        return;
    }

    // Register the save_joke tool so the agent can call it
    function registerTools() {
        if (typeof widget.registerClientTool === 'function') {
            widget.registerClientTool('save_joke', async (params) => {
                console.log('[agent-bridge] save_joke called:', params);
                return await handleToolCall('save_joke', params);
            });
            console.log('[agent-bridge] Registered save_joke client tool');
            return true;
        }
        return false;
    }

    // Try immediately
    if (!registerTools()) {
        // Widget not ready yet — listen for ready event and also poll
        widget.addEventListener('elevenlabs-convai:ready', () => {
            registerTools();
        });

        // Fallback poll in case the event doesn't fire
        let attempts = 0;
        const pollRegister = setInterval(() => {
            attempts++;
            if (registerTools() || attempts > 50) {
                clearInterval(pollRegister);
            }
        }, 300);
    }

    // Also listen for generic tool-call events as a catch-all
    widget.addEventListener('elevenlabs-convai:call', async (e) => {
        const { tool_name, parameters, callback } = e.detail || {};
        console.log('[agent-bridge] Tool call event:', tool_name, parameters);

        try {
            const result = await handleToolCall(tool_name, parameters);
            if (typeof callback === 'function') {
                callback(result);
            }
        } catch (err) {
            console.error('[agent-bridge] Tool call error:', err);
            if (typeof callback === 'function') {
                callback({ error: err.message });
            }
        }
    });

    console.log('[agent-bridge] Widget wired up, waiting for tool registration...');
}

// ===================================
// Handle tool calls
// ===================================

async function handleToolCall(toolName, params) {
    if (toolName === 'save_joke') {
        return await saveJoke(params);
    }
    return { error: `Unknown tool: ${toolName}` };
}

// ===================================
// save_joke — write directly to Firestore
// ===================================

async function saveJoke(params) {
    if (!currentUser) {
        return { error: 'Not authenticated' };
    }

    const content = params.content || params.joke || '';
    let tags = params.tags || [];

    if (typeof tags === 'string') {
        tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    }

    if (!content) {
        return { error: 'Joke content is required' };
    }
    if (!Array.isArray(tags) || tags.length === 0) {
        tags = ['untagged'];
    }

    try {
        const jokeRef = await addDoc(collection(db, 'jokes'), {
            userId: currentUser.uid,
            content: content,
            tags: tags,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('[agent-bridge] Joke saved:', jokeRef.id);
        return {
            success: true,
            message: `Joke saved to Bitbinder! (${jokeRef.id})`,
            jokeId: jokeRef.id
        };
    } catch (error) {
        console.error('[agent-bridge] Error saving joke:', error);
        return { error: 'Failed to save joke: ' + error.message };
    }
}

// ===================================
// Start
// ===================================

init();
