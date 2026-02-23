// ===================================
// Text Chat — type-to-agent interface
//
// Calls the chatWithAgent Cloud Function for text-based
// conversation with the same Bit Builder agent.
// ===================================

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

let auth, functions;
let currentUser = null;
let currentConversationId = null;

// DOM references
let messagesArea, messageInput, sendBtn, chatForm;

// ===================================
// Wait for Firebase, then initialize
// ===================================

function init() {
    if (!window.firebaseApp) {
        setTimeout(init, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    functions = window.firebaseApp.functions;

    messagesArea = document.getElementById('messages-area');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    chatForm = document.getElementById('text-chat-form');

    if (!chatForm) {
        // DOM not ready yet
        setTimeout(init, 100);
        return;
    }

    // Listen for auth state
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        if (user) {
            console.log('[text-chat] User authenticated:', user.uid);
        }
    });

    // Wire up the form
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    // Enter to send (Shift+Enter for newline)
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    console.log('[text-chat] Initialized');
}

// ===================================
// Send a message to the agent
// ===================================

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    if (!currentUser) {
        appendMessage('system', '⚠️ Please log in to chat.');
        return;
    }

    // Show user message immediately
    appendMessage('user', text);
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Disable input while waiting
    setInputEnabled(false);
    const loadingEl = showLoading();

    try {
        const chatWithAgent = httpsCallable(functions, 'chatWithAgent');
        const result = await chatWithAgent({
            message: text,
            conversationId: currentConversationId || null
        });

        // Store conversation ID for follow-up messages
        if (result.data.conversationId) {
            currentConversationId = result.data.conversationId;
        }

        // Remove loading indicator and show response
        removeLoading(loadingEl);
        appendMessage('assistant', result.data.finalResponse || 'No response from agent.');

    } catch (error) {
        console.error('[text-chat] Error:', error);
        removeLoading(loadingEl);
        appendMessage('system', `❌ ${error.message || 'Failed to send message. Please try again.'}`);
    } finally {
        setInputEnabled(true);
        messageInput.focus();
    }
}

// ===================================
// UI Helpers
// ===================================

function appendMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}-message`;

    // Basic markdown-like formatting
    const formatted = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    div.innerHTML = formatted;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function showLoading() {
    const div = document.createElement('div');
    div.className = 'message assistant-message loading-msg';
    div.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
}

function removeLoading(el) {
    if (el && el.parentNode) {
        el.parentNode.removeChild(el);
    }
}

function setInputEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    sendBtn.textContent = enabled ? 'Send' : '...';
}

// ===================================
// Start
// ===================================

init();
