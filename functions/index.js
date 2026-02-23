// ===================================
// Bit Builder - Cloud Functions
// ===================================

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

// Initialize Firebase Admin
admin.initializeApp();

const db = admin.firestore();

// ElevenLabs Configuration (prefer environment config, fallback to provided values)
const ELEVENLABS_API_KEY = functions.config()?.elevenlabs?.key || 'sk_40b434d2a8deebbb7c6683dba782412a0dcc9ff571d042ca';
const ELEVENLABS_AGENT_ID = functions.config()?.elevenlabs?.agent_id || 'agent_7401ka31ry6qftr9ab89em3339w9';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/convai/chat';

// ===================================
// chatWithAgent - Callable Cloud Function
// ===================================

exports.chatWithAgent = functions.https.onCall(async (data, context) => {
    try {
        // 1. Verify authentication
        if (!context.auth) {
            throw new functions.https.HttpsError(
                'unauthenticated',
                'User must be authenticated'
            );
        }

        const userId = context.auth.uid;
        const { message, conversationId } = data;

        // Validate input
        if (!message || typeof message !== 'string') {
            throw new functions.https.HttpsError(
                'invalid-argument',
                'Message must be a non-empty string'
            );
        }

        // 2. Create conversation if needed
        let actualConversationId = conversationId;
        if (!conversationId) {
            const conversationRef = await db.collection('conversations').add({
                userId: userId,
                startedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            actualConversationId = conversationRef.id;
        } else {
            // Verify conversation ownership
            const conversationDoc = await db
                .collection('conversations')
                .doc(conversationId)
                .get();

            if (!conversationDoc.exists || conversationDoc.data().userId !== userId) {
                throw new functions.https.HttpsError(
                    'permission-denied',
                    'User does not own this conversation'
                );
            }
        }

        // 3. Fetch conversation history (last 10 messages)
        const messageSnapshot = await db
            .collection('conversations')
            .doc(actualConversationId)
            .collection('messages')
            .orderBy('timestamp', 'asc')
            .limitToLast(10)
            .get();

        const conversationHistory = messageSnapshot.docs.map(doc => ({
            role: doc.data().role,
            content: doc.data().content
        }));

        // 4. Fetch user's jokes for context
        const jokesSnapshot = await db
            .collection('jokes')
            .where('userId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(10)
            .get();

        const userJokes = jokesSnapshot.docs.map(doc => doc.data().content);

        // 5. Build system prompt with user's jokes context
        const systemPrompt = buildSystemPrompt(userJokes);

        // 6. Prepare messages for ElevenLabs API
        const messagesForAPI = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            { role: 'user', content: message }
        ];

        // 7. Define tools for ElevenLabs
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'save_joke',
                    description: 'Save a joke to the user\'s Bitbinder',
                    parameters: {
                        type: 'object',
                        properties: {
                            content: {
                                type: 'string',
                                description: 'The joke text'
                            },
                            tags: {
                                type: 'array',
                                items: { type: 'string' },
                                description: 'Tags for categorizing the joke (e.g., "pun", "short", "dark")'
                            }
                        },
                        required: ['content', 'tags']
                    }
                }
            }
        ];

        // 8. Call ElevenLabs API with tool support
        let finalResponse = '';
        let toolCallCount = 0;
        const maxToolCallIterations = 5;

        let currentMessages = [...messagesForAPI];

        while (toolCallCount < maxToolCallIterations) {
            const elevenlabsResponse = await callElevenLabsAPI(
                currentMessages,
                tools
            );

            // Extract assistant message
            if (elevenlabsResponse.result?.message) {
                finalResponse = elevenlabsResponse.result.message;
            }

            // Check for tool calls
            if (elevenlabsResponse.result?.tool_calls && 
                elevenlabsResponse.result.tool_calls.length > 0) {
                
                // Add assistant message to conversation
                const assistantMessage = {
                    role: 'assistant',
                    content: finalResponse
                };
                currentMessages.push(assistantMessage);

                // Process each tool call
                const toolResults = [];
                for (const toolCall of elevenlabsResponse.result.tool_calls) {
                    const toolResult = await executeToolCall(
                        toolCall,
                        userId
                    );
                    toolResults.push(toolResult);
                    console.log(`Tool ${toolCall.name} executed:`, toolResult);
                }

                // Add tool results to messages
                for (const result of toolResults) {
                    currentMessages.push({
                        role: 'tool',
                        content: result.message,
                        tool_call_id: result.toolCallId
                    });
                }

                toolCallCount++;
            } else {
                // No more tool calls, exit loop
                break;
            }
        }

        // 9. Save messages to Firestore
        const batch = db.batch();

        // Save user message
        const userMessageRef = db
            .collection('conversations')
            .doc(actualConversationId)
            .collection('messages')
            .doc();
        batch.set(userMessageRef, {
            role: 'user',
            content: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Save assistant message
        const assistantMessageRef = db
            .collection('conversations')
            .doc(actualConversationId)
            .collection('messages')
            .doc();
        batch.set(assistantMessageRef, {
            role: 'assistant',
            content: finalResponse,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        // Save tool messages if any
        const toolMessageIndices = currentMessages
            .map((msg, idx) => msg.role === 'tool' ? idx : -1)
            .filter(idx => idx !== -1);

        for (const idx of toolMessageIndices) {
            const toolMsg = currentMessages[idx];
            const toolMessageRef = db
                .collection('conversations')
                .doc(actualConversationId)
                .collection('messages')
                .doc();
            batch.set(toolMessageRef, {
                role: 'tool',
                content: toolMsg.content,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                toolCallId: toolMsg.tool_call_id
            });
        }

        await batch.commit();

        // 10. Return response
        return {
            conversationId: actualConversationId,
            finalResponse: finalResponse
        };

    } catch (error) {
        console.error('Error in chatWithAgent:', error);
        
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        
        throw new functions.https.HttpsError(
            'internal',
            'Internal server error: ' + error.message
        );
    }
});

// ===================================
// Helper Functions
// ===================================

/**
 * Build system prompt with user's joke context
 */
function buildSystemPrompt(userJokes) {
    let jokesList = '';
    if (userJokes.length > 0) {
        jokesList = '\nPreviously created jokes:\n' + 
                   userJokes.map((joke, idx) => `${idx + 1}. ${joke}`).join('\n');
    } else {
        jokesList = '\nNote: User has no saved jokes yet.';
    }

    return `You are Bit Builder, an AI comedy assistant. Your role is to help users create, develop, and refine comedy material. You're witty, supportive, and knowledgeable about comedy writing techniques.
${jokesList}

You have the ability to save jokes to the user's Bitbinder by calling the \`save_joke\` function. When you and the user agree on a joke that's ready to save, you should call this function with:
- "content": the final joke text
- "tags": an array of relevant tags (e.g., ["pun", "short"], ["observational", "relatable"])

Always ask the user for tag suggestions if they haven't provided them.

Keep your responses concise, friendly, and focused on comedy writing.`;
}

/**
 * Call ElevenLabs Conversational AI API
 */
async function callElevenLabsAPI(messages, tools) {
    try {
        console.log('Calling ElevenLabs API with', messages.length, 'messages');
        
        const response = await axios.post(
            ELEVENLABS_API_URL,
            {
                agent_id: ELEVENLABS_AGENT_ID,
                messages: messages,
                tools: tools
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        return response.data;
    } catch (error) {
        console.error('ElevenLabs API error:', error.response?.data || error.message);
        throw new Error(
            'Failed to get response from ElevenLabs: ' + 
            (error.response?.data?.detail || error.message)
        );
    }
}

/**
 * Execute tool calls from ElevenLabs
 */
async function executeToolCall(toolCall, userId) {
    const toolName = toolCall.name;
    const toolArgs = toolCall.function?.arguments || toolCall.arguments || {};

    console.log(`Executing tool: ${toolName}`, toolArgs);

    if (toolName === 'save_joke') {
        return await saveTool(toolArgs, userId, toolCall.id);
    } else {
        return {
            toolCallId: toolCall.id,
            message: `Unknown tool: ${toolName}`
        };
    }
}

/**
 * save_joke tool implementation
 */
async function saveTool(args, userId, toolCallId) {
    try {
        const { content, tags } = args;

        // Validate
        if (!content || typeof content !== 'string') {
            throw new Error('Joke content must be a non-empty string');
        }
        if (!Array.isArray(tags) || tags.length === 0) {
            throw new Error('Tags must be a non-empty array');
        }

        // Create joke document
        const jokeRef = await db.collection('jokes').add({
            userId: userId,
            content: content,
            tags: tags,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            toolCallId: toolCallId,
            message: `✅ Joke saved successfully to your Bitbinder! (ID: ${jokeRef.id})\n\nJoke: "${content}"\nTags: ${tags.join(', ')}`
        };

    } catch (error) {
        console.error('Error in save_joke:', error);
        return {
            toolCallId: toolCallId,
            message: `❌ Error saving joke: ${error.message}`
        };
    }
}

// ===================================
// Health Check Function
// ===================================

exports.health = functions.https.onRequest((req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'Bit Builder Cloud Functions are running!'
    });
});

// ===================================
// getSignedUrl - Get authenticated WebSocket URL for text chat
// ===================================

exports.getSignedUrl = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            'unauthenticated',
            'User must be authenticated'
        );
    }

    try {
        const response = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${ELEVENLABS_AGENT_ID}`,
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY
                },
                timeout: 10000
            }
        );

        return { signedUrl: response.data.signed_url };
    } catch (error) {
        console.error('Error getting signed URL:', error.response?.data || error.message);
        throw new functions.https.HttpsError(
            'internal',
            'Failed to get signed URL: ' + (error.response?.data?.detail || error.message)
        );
    }
});
