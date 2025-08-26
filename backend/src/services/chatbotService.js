const OpenAI = require('openai');
const RAGService = require('./ragService');
const SessionManager = require('./sessionManager');

class ChatbotService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.ragService = new RAGService();
        this.sessionManager = new SessionManager();
        this.conversationHistory = new Map(); // sessionId -> conversation history
    }

    async initialize() {
        try {
            await this.ragService.initialize();
            console.log('✅ Chatbot service initialized with RAG');
        } catch (error) {
            console.error('❌ Failed to initialize chatbot service:', error);
        }
    }

    async initializeSession(logData) {
        try {
            const sessionId = this.sessionManager.createSession(logData);
            this.conversationHistory.set(sessionId, []);
            
            console.log(`✅ Session initialized: ${sessionId}`);
            return { sessionId, success: true };
        } catch (error) {
            console.error('❌ Failed to initialize session:', error);
            return { sessionId: null, success: false, error: error.message };
        }
    }

    async processMessage(userMessage, sessionId) {
        try {
            // Get session data
            const session = this.sessionManager.getSession(sessionId);
            if (!session) {
                return {
                    response: "Session not found. Please refresh the page and try again.",
                    relevantDocs: [],
                    error: "SESSION_NOT_FOUND"
                };
            }

            // Add user message to session history
            this.addToHistory(sessionId, 'user', userMessage);

            // Get relevant documentation context
            const relevantDocs = await this.ragService.searchRelevantDocs(userMessage, 3);
            
            // Prepare the prompt with context
            const prompt = this.buildPrompt(userMessage, relevantDocs, session.logData, sessionId);
            
            // Get AI response
            const response = await this.getAIResponse(prompt);
            
            // Add AI response to session history
            this.addToHistory(sessionId, 'assistant', response);
            
            return {
                response: response,
                relevantDocs: relevantDocs.map(doc => ({
                    content: doc.content.substring(0, 200) + '...',
                    similarity: doc.similarity.toFixed(3)
                }))
            };
            
        } catch (error) {
            console.error('❌ Error processing message:', error);
            return {
                response: `I encountered an error while processing your request: ${error.message}. Please try again.`,
                relevantDocs: []
            };
        }
    }

    buildPrompt(userMessage, relevantDocs, logData, sessionId) {
        let prompt = `You are an AI assistant specialized in analyzing UAV telemetry logs from ArduPilot-based vehicles. 

Your role is to:
1. Help users understand their flight data
2. Analyze telemetry information
3. Detect potential issues or anomalies
4. Provide insights about flight performance

IMPORTANT: Always maintain an agentic approach. If you need clarification or are not confident about your response, ask specific questions to gather more information.

Current user question: "${userMessage}"

`;

        // Add relevant documentation context
        if (relevantDocs.length > 0) {
            prompt += `\nRelevant ArduPilot documentation:\n`;
            relevantDocs.forEach((doc, index) => {
                prompt += `\n--- Documentation ${index + 1} (Relevance: ${(doc.similarity * 100).toFixed(1)}%) ---\n`;
                prompt += doc.content;
                prompt += `\n--- End Documentation ${index + 1} ---\n`;
            });
        }

        // Add log data context if available
        if (logData) {
            prompt += `\nAvailable log data:\n`;
            if (logData.messageTypes) {
                prompt += `- Telemetry messages: ${logData.messageTypes.length} message types available\n`;
                prompt += `  Message types: ${logData.messageTypes.join(', ')}\n`;
                if (logData.messageCounts) {
                    prompt += `  Sample counts: ${Object.entries(logData.messageCounts).map(([type, count]) => `${type}: ${count}`).join(', ')}\n`;
                }
            }
            if (logData.trajectorySources) {
                prompt += `- Flight trajectories: ${logData.trajectorySources.length} trajectory sources\n`;
                if (logData.trajectoryCounts) {
                    prompt += `  Trajectory points: ${Object.entries(logData.trajectoryCounts).map(([source, count]) => `${source}: ${count}`).join(', ')}\n`;
                }
            }
            if (logData.paramCount) {
                prompt += `- Vehicle parameters: ${logData.paramCount} parameters available\n`;
                if (logData.paramCategories) {
                    prompt += `  Categories: ${Object.entries(logData.paramCategories).map(([cat, count]) => `${cat}: ${count}`).join(', ')}\n`;
                }
            }
            if (logData.eventCount) {
                prompt += `- Flight events: ${logData.eventCount} events recorded\n`;
                if (logData.eventTypes) {
                    prompt += `  Event types: ${Object.entries(logData.eventTypes).map(([type, count]) => `${type}: ${count}`).join(', ')}\n`;
                }
            }
            if (logData.flightModeCount) {
                prompt += `- Flight mode changes: ${logData.flightModeCount} mode transitions\n`;
                if (logData.flightModes) {
                    prompt += `  Modes used: ${logData.flightModes.join(', ')}\n`;
                }
            }
            if (logData.file) {
                prompt += `- Log file: ${logData.file}\n`;
            }
            if (logData.logType) {
                prompt += `- Log type: ${logData.logType}\n`;
            }
        }

        // Add conversation history for context
        const sessionHistory = this.conversationHistory.get(sessionId);
        if (sessionHistory && sessionHistory.length > 0) {
            prompt += `\nConversation history:\n`;
            sessionHistory.slice(-5).forEach(msg => {
                prompt += `${msg.role}: ${msg.content}\n`;
            });
        }

        prompt += `\nPlease provide a helpful, accurate response. If you need clarification or are unsure about any aspect, ask specific questions. Be conversational but professional.`;

        return prompt;
    }

    async getAIResponse(prompt) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4.1-nano",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert UAV telemetry analyst with deep knowledge of ArduPilot systems. Always be helpful, accurate, and ask clarifying questions when needed."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.7
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error('❌ OpenAI API error:', error);
            throw new Error('Failed to get AI response');
        }
    }

    addToHistory(sessionId, role, content) {
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        
        const sessionHistory = this.conversationHistory.get(sessionId);
        sessionHistory.push({
            role: role,
            content: content,
            timestamp: new Date().toISOString()
        });

        // Keep only last 20 messages per session to prevent token bloat
        if (sessionHistory.length > 20) {
            sessionHistory.splice(0, sessionHistory.length - 20);
        }
    }

    getConversationHistory(sessionId) {
        return this.conversationHistory.get(sessionId) || [];
    }

    clearHistory(sessionId) {
        if (sessionId) {
            this.conversationHistory.set(sessionId, []);
        } else {
            this.conversationHistory.clear();
        }
    }

    getSessionStats() {
        return this.sessionManager.getSessionStats();
    }

    async validateSession(sessionId) {
        try {
            const session = this.sessionManager.getSession(sessionId);
            if (!session) {
                return null;
            }

            // Check if session is not too old (e.g., 24 hours)
            const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
            const now = Date.now();
            
            if (now - session.createdAt > maxAge) {
                // Session is too old, remove it
                this.sessionManager.removeSession(sessionId);
                return null;
            }

            // Update last accessed time
            this.sessionManager.updateSession(sessionId);
            return session;
        } catch (error) {
            console.error('Error validating session:', error);
            return null;
        }
    }
}

module.exports = ChatbotService;

