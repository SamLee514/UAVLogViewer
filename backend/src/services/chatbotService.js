const OpenAI = require('openai');
const RAGService = require('./ragService');
const SessionManager = require('./sessionManager');
const LogDataProcessor = require('./logDataProcessor');
const QueryValidator = require('./queryValidator');

class ChatbotService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.ragService = new RAGService();
        this.sessionManager = new SessionManager();
        this.logDataProcessor = new LogDataProcessor();
        this.queryValidator = new QueryValidator(this.logDataProcessor);
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
            
            // Define available tools for the LLM
            const availableTools = [
                {
                    type: "function",
                    function: {
                        name: "queryData",
                        description: "Execute SQL queries on the telemetry data to get exact results",
                        parameters: {
                            type: "object",
                            properties: {
                                sql: {
                                    type: "string",
                                    description: "SQL query to execute (e.g., 'SELECT MAX(Alt) FROM gps_0_data')"
                                }
                            },
                            required: ["sql"]
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "getMessageTypes",
                        description: "Get list of available message types in the log data",
                        parameters: {
                            type: "object",
                            properties: {}
                        }
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "getDataSchema",
                        description: "Get detailed schema information for all available tables",
                        parameters: {
                            type: "object",
                            properties: {}
                        }
                    }
                }
            ];

            // Get AI response with tools
            const response = await this.getAIResponse(prompt, availableTools);
            
            // Validate the response by executing any mentioned queries
            console.log('🔍 Validating LLM response for query accuracy...');
            const validationResult = await this.queryValidator.validateResponse(response);
            
            // Add AI response to session history
            this.addToHistory(sessionId, 'assistant', response);
            
            // Parse the response to separate reasoning from final answer
            const parsedResponse = this.parseAIResponse(response);
            
            // Generate corrective feedback if there are discrepancies
            let finalResponse = response;
            let correctiveFeedback = '';
            
            if (validationResult.queriesWithDiscrepancies > 0) {
                console.log(`🚨 Found ${validationResult.queriesWithDiscrepancies} queries with discrepancies`);
                correctiveFeedback = this.queryValidator.generateCorrectiveFeedback(validationResult.validations);
                
                // If there are major discrepancies, ask the LLM to correct itself
                if (validationResult.queriesWithDiscrepancies > 0) {
                    const correctionPrompt = `Your previous response contained incorrect data. Here are the actual query results:

${correctiveFeedback}

Please provide a corrected response using ONLY the actual data from the queries above. Do not make up any numbers.`;
                    
                    console.log('🔄 Requesting correction from LLM...');
                    const correctedResponse = await this.getAIResponse(correctionPrompt);
                    finalResponse = correctedResponse;
                    
                    // Parse the corrected response
                    const correctedParsed = this.parseAIResponse(correctedResponse);
                    parsedResponse.finalAnswer = correctedParsed.finalAnswer;
                    parsedResponse.reasoning = correctedParsed.reasoning;
                }
            }
            
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
                availableTables: availableTables,
                queryValidation: {
                    totalQueries: validationResult.totalQueries,
                    validQueries: validationResult.validQueries,
                    queriesWithDiscrepancies: validationResult.queriesWithDiscrepancies,
                    hasDiscrepancies: validationResult.queriesWithDiscrepancies > 0
                }
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

🔧 TOOL USAGE INSTRUCTIONS:
You have access to powerful tools to analyze the data. Use them instead of guessing:

1. queryData(sql) - Execute SQL queries to get exact results
2. getMessageTypes() - See what data types are available
3. getDataSchema() - Get detailed schema information

EXAMPLE USAGE:
- To find maximum altitude: Use queryData("SELECT MAX(Alt) FROM gps_0_data")
- To count records: Use queryData("SELECT COUNT(*) FROM att_data")
- To get data schema: Use getDataSchema()

⚠️ IMPORTANT: Always use the tools to get real data. Do not make up numbers or results!

📊 DUCKDB COMPATIBILITY NOTES:
- Use PERCENTILE(0.5) instead of PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY column)
- Use time_boot_ms (not TimeUS) for timestamps
- Use Alt for altitude, Roll for roll, Pitch for pitch
- All tables have time_boot_ms as the primary time column`;

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

    async getAIResponse(prompt, availableTools = []) {
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
                tools: availableTools,
                tool_choice: "auto", // Force the LLM to use tools when needed
                max_tokens: 1000,
                temperature: 0.7
            });

            const message = completion.choices[0].message;
            
            // Check if the LLM made tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log(`🔧 LLM made ${message.tool_calls.length} tool call(s)`);
                return await this.handleToolCalls(message.tool_calls, prompt);
            }
            
            return message.content;
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

    /**
     * Handle tool calls made by the LLM
     * @param {Array} toolCalls - Array of tool calls from the LLM
     * @param {string} originalPrompt - The original user prompt
     * @returns {Promise<string>} Final response after tool execution
     */
    async handleToolCalls(toolCalls, originalPrompt) {
        console.log('🔄 Handling tool calls...');
        
        const toolResults = [];
        
        // Execute each tool call
        for (const toolCall of toolCalls) {
            try {
                console.log(`🔧 Executing tool: ${toolCall.function.name}`);
                
                let result;
                switch (toolCall.function.name) {
                    case 'queryData':
                        const { sql } = JSON.parse(toolCall.function.arguments);
                        console.log(`📊 Executing SQL: ${sql}`);
                        result = await this.logDataProcessor.query(sql);
                        break;
                        
                    case 'getMessageTypes':
                        result = await this.logDataProcessor.getMessageTypes();
                        break;
                        
                    case 'getDataSchema':
                        result = await this.logDataProcessor.getDataSchema();
                        break;
                        
                    default:
                        result = { error: `Unknown tool: ${toolCall.function.name}` };
                }
                
                // Handle BigInt serialization issue
                let serializedResult;
                try {
                    serializedResult = JSON.stringify(result, (key, value) => {
                        if (typeof value === 'bigint') {
                            return Number(value);
                        }
                        return value;
                    });
                } catch (error) {
                    console.warn(`⚠️ Serialization error for ${toolCall.function.name}:`, error);
                    serializedResult = JSON.stringify({ error: 'Serialization failed', originalError: error.message });
                }
                
                toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: serializedResult
                });
                
                console.log(`✅ Tool ${toolCall.function.name} executed successfully`);
                
            } catch (error) {
                console.error(`❌ Error executing tool ${toolCall.function.name}:`, error);
                toolResults.push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: JSON.stringify({ error: error.message })
                });
            }
        }
        
        // Continue the conversation with tool results
        console.log('🔄 Continuing conversation with tool results...');
        
        // We need to include the assistant message that made the tool calls
        const assistantMessage = {
            role: "assistant",
            content: null,
            tool_calls: toolCalls
        };
        
        const messages = [
            {
                role: "system",
                content: "You are an expert UAV telemetry analyst. Use the tool results to provide accurate answers."
            },
            {
                role: "user",
                content: originalPrompt
            },
            assistantMessage,
            ...toolResults
        ];
        
        const finalResponse = await this.openai.chat.completions.create({
            model: "gpt-4.1-nano",
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7
        });
        
        return finalResponse.choices[0].message.content;
    }
}

module.exports = ChatbotService;

