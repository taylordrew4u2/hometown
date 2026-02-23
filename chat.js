// ===================================
// Bit Builder - Dashboard Chat Logic
// ===================================

import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

// Firebase references (will be available from app.js)
let auth, db, functions;
let currentConversationId = null;
let messagesUnsubscribe = null;
let speechRecognition = null;
let isListening = false;

// Elements
let messagesArea, messageInput, sendBtn, voiceBtn, loadingIndicator, voiceStatus, bitbinderBtn;
let hasBoundUi = false;
let hasAuthListener = false;

// ===================================
// Wait for Firebase to be ready
// ===================================

const initChatApp = () => {
    // Get Firebase references
    if (!window.firebaseApp) {
        console.error('Firebase not initialized yet');
        setTimeout(initChatApp, 100);
        return;
    }

    auth = window.firebaseApp.auth;
    db = window.firebaseApp.db;
    functions = window.firebaseApp.functions;

    // Get DOM elements
    messagesArea = document.getElementById('messages-area');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    voiceBtn = document.getElementById('voice-btn');
    loadingIndicator = document.getElementById('loading-indicator');
    voiceStatus = document.getElementById('voice-status');
    bitbinderBtn = document.getElementById('bitbinder-btn');

    // ===================================
    // Initialize
    // ===================================

    if (!hasBoundUi) {
        const bindUi = () => {
            // Set up event listeners
            sendBtn.addEventListener('click', sendMessage);
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            voiceBtn.addEventListener('click', toggleVoiceRecording);
            bitbinderBtn.addEventListener('click', () => {
                window.location.href = 'binder.html';
            });

            // Initialize speech recognition if available
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                speechRecognition = new SpeechRecognition();
                speechRecognition.continuous = false;
                speechRecognition.interimResults = false;
                speechRecognition.lang = 'en-US';

                speechRecognition.onstart = () => {
                    isListening = true;
                    voiceBtn.classList.add('recording');
                    voiceStatus.textContent = 'Listening...';
                    voiceStatus.classList.remove('hidden');
                };

                speechRecognition.onend = () => {
                    isListening = false;
                    voiceBtn.classList.remove('recording');
                    voiceStatus.classList.add('hidden');
                };

                speechRecognition.onresult = (event) => {
                    let transcript = '';
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        transcript += event.results[i][0].transcript;
                    }
                    if (event.isFinal) {
                        messageInput.value = transcript;
                        sendMessage();
                    }
                };

                speechRecognition.onerror = (event) => {
                    console.error('Speech recognition error', event.error);
                    voiceStatus.textContent = 'Error: ' + event.error;
                };
            } else {
                voiceBtn.style.display = 'none';
            }
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bindUi, { once: true });
        } else {
            bindUi();
        }

        hasBoundUi = true;
    }

    if (!hasAuthListener) {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                initializeConversation(user);
                return;
            }

            currentConversationId = null;
            if (messagesUnsubscribe) {
                messagesUnsubscribe();
                messagesUnsubscribe = null;
            }
            if (messagesArea) {
                messagesArea.innerHTML = '';
            }
        });

        hasAuthListener = true;
    }
};

// ===================================
// Initialize
// ===================================

initChatApp();

// ===================================
// Initialize Conversation
// ===================================

async function initializeConversation(user) {
    if (!user) {
        user = auth.currentUser;
    }
    if (!user) {
        console.error('No authenticated user for conversation init');
        return;
    }

    // Try to get existing conversation from sessionStorage
    currentConversationId = sessionStorage.getItem('conversationId');

    if (!currentConversationId) {
        await createNewConversation(user);
    }

    // Listen to messages in real-time
    if (currentConversationId) {
        setupMessagesListener();
    }
}

async function createNewConversation(user) {
    if (!user) {
        user = auth.currentUser;
    }
    if (!user) return null;

    try {
        const conversationRef = await addDoc(collection(db, 'conversations'), {
            userId: user.uid,
            startedAt: serverTimestamp()
        });
        currentConversationId = conversationRef.id;
        sessionStorage.setItem('conversationId', currentConversationId);
        console.log('Created conversation:', currentConversationId);
        return currentConversationId;
    } catch (error) {
        console.error('Error creating conversation:', error);
        return null;
    }
}

// ===================================
// Real-time Messages Listener
// ===================================

function setupMessagesListener() {
    if (!currentConversationId || !auth.currentUser) return;

    // Unsubscribe from previous listener if exists
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
    }

    const messagesQuery = query(
        collection(db, 'conversations', currentConversationId, 'messages'),
        orderBy('timestamp', 'asc')
    );

    messagesUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
        renderMessages(snapshot.docs);
        // Scroll to bottom
        setTimeout(() => {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }, 0);
    });
}

// ===================================
// Send Message
// ===================================

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Create conversation on-demand if it doesn't exist yet
    if (!currentConversationId) {
        console.log('No conversation yet, creating one before sending...');
        await createNewConversation();
        if (currentConversationId) {
            setupMessagesListener();
        }
    }

    if (!currentConversationId) {
        showChatError('Unable to start a conversation. Please refresh and try again.');
        return;
    }

    messageInput.value = '';
    loadingIndicator.classList.remove('hidden');

    try {
        // Call the Cloud Function
        const chatWithAgent = httpsCallable(functions, 'chatWithAgent');
        console.log('Sending message to chatWithAgent:', { message, conversationId: currentConversationId });
        const response = await chatWithAgent({
            message: message,
            conversationId: currentConversationId
        });

        console.log('Assistant response:', response.data);
        // Messages will be displayed via the real-time listener
    } catch (error) {
        console.error('Error calling chatWithAgent:', error);
        showChatError(error.message || 'Failed to get response from agent');
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

function showChatError(text) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error-message';
    errorDiv.textContent = 'Error: ' + text;
    messagesArea.appendChild(errorDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

// ===================================
// Voice Recording Toggle
// ===================================

function toggleVoiceRecording() {
    if (!speechRecognition) return;

    if (isListening) {
        speechRecognition.stop();
    } else {
        speechRecognition.start();
    }
}

// ===================================
// Render Messages
// ===================================

function renderMessages(docs) {
    messagesArea.innerHTML = '';

    docs.forEach((doc) => {
        const message = doc.data();
        const messageEl = createMessageElement(message);
        messagesArea.appendChild(messageEl);
    });
}

function createMessageElement(message) {
    const div = document.createElement('div');
    const roleClass = message.role === 'user' ? 'user-message' : 'assistant-message';
    div.className = `message ${roleClass}`;

    // For tool messages, use a different style
    if (message.role === 'tool') {
        div.className = 'message tool-message';
        div.innerHTML = `<strong>[System]</strong> ${escapeHtml(message.content)}`;
    } else {
        div.textContent = message.content;
    }

    return div;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
