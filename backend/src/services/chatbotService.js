const OpenAI = require('openai');
const RAGService = require('./ragService');
const SessionManager = require('./sessionManager');
const LogDataProcessor = require('./logDataProcessor');

class ChatbotService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.ragService = new RAGService();
        this.sessionManager = new SessionManager();
        this.logDataProcessor = new LogDataProcessor();
        this.conversationHistory = new Map(); // sessionId -> conversation history
    }

    async initialize() {
        try {
            await this.ragService.initialize();
            await this.logDataProcessor.initialize();
            console.log('✅ Chatbot service initialized with RAG and DuckDB');
        } catch (error) {
            console.error('❌ Failed to initialize chatbot service:', error);
        }
    }

    async initializeSession(logData) {
        try {
            // Process log data and load into DuckDB
            console.log('🔄 Processing log data with DuckDB...');
            const processingResult = await this.logDataProcessor.processLogData(logData);
            console.log('✅ Log data processed and loaded into DuckDB');
            
            const sessionId = this.sessionManager.createSession(logData);
            this.conversationHistory.set(sessionId, []);
            
            console.log(`✅ Session initialized: ${sessionId}`);
            return { sessionId, success: true, processingResult };
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
            
            // Get data schema and available tables for the LLM
            const dataSchema = await this.logDataProcessor.getDataSchema();
            const availableTables = await this.logDataProcessor.getAvailableTables();
            
            // Prepare the prompt with context
            const prompt = this.buildPrompt(userMessage, relevantDocs, session.logData, sessionId, dataSchema, availableTables);
            
            // Get AI response
            const response = await this.getAIResponse(prompt);
            
            // Add AI response to session history
            this.addToHistory(sessionId, 'assistant', response);
            
            // Parse the response to separate reasoning from final answer
            const parsedResponse = this.parseAIResponse(response);
            
            console.log('🔍 Parsed AI response:', {
                original: response.substring(0, 500) + '...',
                finalAnswer: parsedResponse.finalAnswer,
                reasoning: parsedResponse.reasoning ? parsedResponse.reasoning.substring(0, 200) + '...' : 'none',
                originalLength: response.length
            });
            
            return {
                response: parsedResponse.finalAnswer,
                thinking: parsedResponse.reasoning,
                relevantDocs: relevantDocs.map(doc => ({
                    content: doc.content.substring(0, 200) + '...',
                    similarity: doc.similarity.toFixed(3)
                })),
                dataSchema: dataSchema,
                availableTables: availableTables
            };
            
        } catch (error) {
            console.error('❌ Error processing message:', error);
            
            // Provide a more helpful error message
            let errorMessage = 'I encountered an error while processing your request.';
            
            if (error.message.includes('Cannot read properties of undefined')) {
                errorMessage = 'I encountered an issue with the log data format. This might happen if the log file has an unexpected structure or is missing some data fields.';
            } else if (error.message.includes('JSON')) {
                errorMessage = 'I encountered an issue parsing the log data. The file format might be corrupted or incomplete.';
            } else if (error.message.includes('OpenAI')) {
                errorMessage = 'I encountered an issue with the AI service. Please try again in a moment.';
            }
            
            return {
                response: errorMessage,
                thinking: `Technical error details: ${error.message}. This usually indicates the log data structure is different than expected.`,
                relevantDocs: []
            };
        }
    }

    buildPrompt(userMessage, relevantDocs, logData, sessionId, dataSchema, availableTables) {
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
            
            // File information
            if (logData.file) {
                prompt += `- Log file: ${logData.file}\n`;
            }
            if (logData.logType) {
                prompt += `- Log type: ${logData.logType}\n`;
            }
            
            // Add DuckDB table schema information
            if (dataSchema && Object.keys(dataSchema).length > 0) {
                prompt += `\nDUCKDB TABLES AVAILABLE:\n`;
                Object.keys(dataSchema).forEach(messageType => {
                    const tableInfo = dataSchema[messageType];
                    prompt += `\n--- ${messageType} (table: ${tableInfo.tableName}) ---\n`;
                    prompt += `Fields: ${tableInfo.fields.map(f => `${f.name} (${f.type})`).join(', ')}\n`;
                });
            }
            
            // Complete message data (no assumptions about structure)
            if (logData.messages) {
                console.log('🔍 Building prompt with logData.messages structure:');
                const messageTypes = Object.keys(logData.messages);
                console.log(`  Total message types: ${messageTypes.length}`);
                console.log(`  Message types: ${messageTypes.join(', ')}`);
                
                prompt += `- Telemetry messages: ${messageTypes.length} message types available\n`;
                prompt += `  Message types: ${messageTypes.join(', ')}\n`;
                
                // Include message counts for context
                messageTypes.forEach(type => {
                    try {
                        const messages = logData.messages[type];
                        if (Array.isArray(messages)) {
                            prompt += `  ${type}: ${messages.length} messages\n`;
                        }
                    } catch (error) {
                        // Skip if there's an issue with this message type
                    }
                });
            }
            
            // Complete trajectory data
            if (logData.trajectories) {
                const trajectorySources = Object.keys(logData.trajectories);
                prompt += `- Flight trajectories: ${trajectorySources.length} trajectory sources\n`;
                trajectorySources.forEach(source => {
                    try {
                        const trajectory = logData.trajectories[source];
                        if (trajectory && trajectory.trajectory && Array.isArray(trajectory.trajectory)) {
                            prompt += `  ${source}: ${trajectory.trajectory.length} trajectory points\n`;
                        }
                    } catch (error) {
                        // Skip if there's an issue with this trajectory source
                    }
                });
            }
            
            // Complete parameter data
            if (logData.params && logData.params.values) {
                const paramKeys = Object.keys(logData.params.values);
                prompt += `- Vehicle parameters: ${paramKeys.length} parameters available\n`;
                if (paramKeys.length > 0) {
                    prompt += `  Sample parameters: ${paramKeys.slice(0, 10).join(', ')}${paramKeys.length > 10 ? '...' : ''}\n`;
                }
            }
            
            // Complete event data
            if (logData.events && Array.isArray(logData.events)) {
                prompt += `- Flight events: ${logData.events.length} events recorded\n`;
            }
            
            // Complete flight mode changes
            if (logData.flightModeChanges && Array.isArray(logData.flightModeChanges)) {
                prompt += `- Flight mode changes: ${logData.flightModeChanges.length} mode transitions\n`;
            }
            
            // Any other available data
            if (logData.namedFloats) {
                prompt += `- Named float values available\n`;
            }
            if (logData.mission) {
                prompt += `- Mission data available\n`;
            }
            if (logData.fences) {
                prompt += `- Geofence data available\n`;
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

        prompt += `\nPlease provide a helpful, accurate response. If you need clarification or are unsure about any aspect, ask specific questions. Be conversational but professional.

CRITICAL: You MUST format your response exactly like this:

ANSWER: [Your direct, actionable answer here - be concise and specific]

REASONING: [Your detailed reasoning, analysis steps, and methodology here]

Do not deviate from this format. Always start with "ANSWER:" and then "REASONING:" on separate lines.

IMPORTANT: You now have access to the COMPLETE, UNCOMPRESSED log dataset loaded into DuckDB tables. Use this data to provide accurate, data-driven answers. You can analyze:
- All GPS coordinates, altitudes, and timestamps
- Complete flight mode change sequences with exact timings
- All parameter values and their meanings
- Complete event logs and error messages
- Full trajectory data with precise coordinates
- Any other telemetry data available in the logs

QUERY TOOLS AVAILABLE:
You can use these tools to analyze the data:
- queryData(sql) - Execute SQL queries on the telemetry data
- getMessageTypes() - Get list of available message types
- getDataSchema() - Get schema information for all tables

ANALYSIS APPROACH:
Instead of trying to parse raw numbers, use SQL queries to:
- Find maximums/minimums: SELECT MAX(alt) FROM gps_data
- Calculate averages: SELECT AVG(roll) FROM att_data  
- Filter by time: WHERE time_boot_ms BETWEEN 0 AND 300000
- Join related data: GPS + attitude for position analysis

Be confident and decisive - you have the complete dataset to work with and powerful query tools.`;

        return prompt;
    }

    parseAIResponse(response) {
        console.log('🔍 parseAIResponse input:', response.substring(0, 300) + '...');
        
        // Try to parse structured response with ANSWER/REASONING format
        const answerMatch = response.match(/ANSWER:\s*(.*?)(?=\nREASONING:|$)/s);
        const reasoningMatch = response.match(/REASONING:\s*(.*)/s);
        
        console.log('🔍 Regex matches:', {
            answerMatch: answerMatch ? answerMatch[1].substring(0, 100) + '...' : 'none',
            reasoningMatch: reasoningMatch ? reasoningMatch[1].substring(0, 100) + '...' : 'none'
        });
        
        if (answerMatch && reasoningMatch) {
            console.log('✅ Found structured ANSWER/REASONING format');
            return {
                finalAnswer: answerMatch[1].trim(),
                reasoning: reasoningMatch[1].trim()
            };
        }
        
        console.log('⚠️ No structured format found, using fallback parsing');
        
        // Fallback: if no structured format, treat entire response as reasoning
        // and try to extract a concise answer from the first paragraph
        const paragraphs = response.split('\n\n');
        const firstParagraph = paragraphs[0] || response;
        
        // Try to find a sentence that looks like a direct answer
        const sentences = firstParagraph.split(/[.!?]+/);
        const directAnswer = sentences.find(sentence => 
            sentence.trim().length > 10 && 
            sentence.trim().length < 200 &&
            !sentence.includes('Could you clarify') &&
            !sentence.includes('Would you like me to') &&
            !sentence.includes('Alternatively') &&
            !sentence.includes('If you prefer')
        );
        
        const result = {
            finalAnswer: directAnswer ? directAnswer.trim() + '.' : response.substring(0, 300) + '...',
            reasoning: response
        };
        
        console.log('🔍 Fallback parsing result:', {
            finalAnswer: result.finalAnswer.substring(0, 100) + '...',
            reasoningLength: result.reasoning.length
        });
        
        return result;
    }

    async getAIResponse(prompt) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4.1-nano",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert UAV telemetry analyst with deep knowledge of ArduPilot systems. Your primary goal is to provide direct, actionable answers to user questions about their flight data. When analyzing logs, be confident and decisive - don't ask for clarification unless absolutely necessary. Use the available log data to provide concrete answers."
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

