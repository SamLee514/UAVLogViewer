const OpenAI = require('openai');
const RAGService = require('./ragService');
const SessionManager = require('./sessionManager');
const LogDataProcessor = require('./logDataProcessor');
const QueryValidator = require('./queryValidator');
const AnswerValidator = require('./answerValidator');

class ChatbotService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.ragService = new RAGService();
        this.sessionManager = new SessionManager();
        this.logDataProcessor = new LogDataProcessor();
        this.queryValidator = new QueryValidator(this.logDataProcessor);
        this.answerValidator = new AnswerValidator(process.env.OPENAI_API_KEY);
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
            
            // Detect potential prompt injection attempts
            console.log('🔒 Checking for prompt injection...');
            const injectionDetection = await this.answerValidator.detectPromptInjection(userMessage);
            
            if (injectionDetection.isSuspicious) {
                console.log(`🚨 Potential prompt injection detected: ${injectionDetection.reason} (Risk: ${injectionDetection.riskLevel})`);
                
                return {
                    response: "I cannot process this request as it appears to contain suspicious content. Please ask a clear question about your flight data.",
                    thinking: `Prompt injection detected: ${injectionDetection.reason}`,
                    relevantDocs: [],
                    dataSchema: null,
                    availableTables: null,
                    queryValidation: { totalQueries: 0, validQueries: 0, queriesWithDiscrepancies: 0, hasDiscrepancies: false },
                    answerValidation: { wasCorrected: false, correctionAttempts: 0, originalResponse: null }
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
            
            // Validate answer quality and handle reasoning vs. answers
            let finalResponse = response;
            let correctiveFeedback = '';
            let answerCorrectionAttempts = 0;
            
            // First, validate that the response is actually an answer, not just reasoning
            console.log('🔍 Validating answer quality...');
            const answerValidation = await this.answerValidator.validateAnswerQuality(response, userMessage);
            
            // Parse the response using the intelligent validation result
            const parsedResponse = this.parseAIResponse(response, answerValidation);
            
            // Handle answer validation corrections (up to 3 retries)
            if (!answerValidation.isValid && answerCorrectionAttempts < this.answerValidator.maxRetries) {
                console.log(`🚨 Answer validation failed - response is reasoning, not answer (attempt ${answerCorrectionAttempts + 1})`);
                
                // Generate correction prompt for answer quality
                const answerCorrectionPrompt = this.answerValidator.generateCorrectionPrompt(userMessage, response, answerValidation);
                
                console.log('🔄 Requesting answer correction from LLM...');
                const correctedResponse = await this.getAIResponse(answerCorrectionPrompt, availableTools);
                finalResponse = correctedResponse;
                
                // Parse the corrected response using validation result
                const correctedParsed = this.parseAIResponse(correctedResponse, answerValidation);
                parsedResponse.finalAnswer = correctedParsed.finalAnswer;
                parsedResponse.reasoning = correctedParsed.reasoning;
                
                answerCorrectionAttempts++;
                
                // Validate the corrected response
                if (answerCorrectionAttempts < this.answerValidator.maxRetries) {
                    const revalidation = await this.answerValidator.validateAnswerQuality(correctedResponse, userMessage);
                    if (!revalidation.isValid) {
                        console.log(`🚨 Second attempt also failed - trying one more time...`);
                        const secondCorrectionPrompt = this.answerValidator.generateCorrectionPrompt(userMessage, correctedResponse, revalidation);
                        const secondCorrectedResponse = await this.getAIResponse(secondCorrectionPrompt, availableTools);
                        finalResponse = secondCorrectedResponse;
                        
                        // Parse the second corrected response using validation result
                        const secondParsed = this.parseAIResponse(secondCorrectedResponse, revalidation);
                        parsedResponse.finalAnswer = secondParsed.finalAnswer;
                        parsedResponse.reasoning = secondParsed.reasoning;
                        answerCorrectionAttempts++;
                    }
                }
            }
            
            if (validationResult.queriesWithDiscrepancies > 0) {
                console.log(`🚨 Found ${validationResult.queriesWithDiscrepancies} queries with discrepancies`);
                correctiveFeedback = this.queryValidator.generateCorrectiveFeedback(validationResult.validations);
                
                // If there are major discrepancies, ask the LLM to correct itself
                if (validationResult.queriesWithDiscrepancies > 0) {
                    const correctionPrompt = `🚨 CRITICAL: Your previous response contained incorrect data!

${correctiveFeedback}

🔧 IMPORTANT: You have access to these tools - USE THEM to get real data:
- queryData: Execute SQL queries on the telemetry data
- getMessageTypes: Get list of available message types  
- getDataSchema: Get detailed schema information

🚨 REQUIREMENT: Use the tools above to query the actual data, then provide a corrected response using ONLY the real data. Do not make up any numbers.`;
                    
                    console.log('🔄 Requesting correction from LLM...');
                    const correctedResponse = await this.getAIResponse(correctionPrompt, availableTools);
                    finalResponse = correctedResponse;
                    
                                    // Parse the corrected response using validation result
                const correctedParsed = this.parseAIResponse(correctedResponse, validationResult);
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
                },
                answerValidation: {
                    wasCorrected: answerCorrectionAttempts > 0,
                    correctionAttempts: answerCorrectionAttempts,
                    originalResponse: answerCorrectionAttempts > 0 ? response : null
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

🚨 AGENTIC BEHAVIOR REQUIREMENTS:
- ALWAYS be proactive and ask for clarification when needed
- If a question is ambiguous, unclear, or could have multiple interpretations, ASK for clarification
- If you need more specific information to provide a useful answer, REQUEST it
- If you're not confident about your analysis, SAY SO and ask follow-up questions
- NEVER guess or make assumptions - either ask for clarification or state what you need to know

🚨 CLARIFICATION TRIGGERS - ASK FOR CLARIFICATION WHEN:
- Question is vague: "Are there any issues?" → Ask: "What specific issues concern you?"
- Question is ambiguous: "How does the data look?" → Ask: "What aspects of the data interest you?"
- Question lacks context: "Is this normal?" → Ask: "What would you consider 'normal' for this flight?"
- Question is too broad: "Analyze the flight" → Ask: "What specific aspects should I focus on?"

🚨 CLARIFICATION EXAMPLES:
❌ DON'T: "I will analyze the data to find issues"
✅ DO: "I can analyze the data, but to give you the most helpful answer, could you clarify: What specific issues are you most concerned about - GPS accuracy, flight stability, altitude problems, or something else?"

🚨 CLARIFICATION FORMAT - BE DIRECT:
- ❌ DON'T: "To determine if there are issues, I will examine the data..."
- ✅ DO: "To give you the most helpful answer, could you clarify: [specific question]?"

🚨 FOR VAGUE QUESTIONS, ASK DIRECTLY:
- "Are there any issues?" → "What specific issues concern you most?"
- "How does the data look?" → "What aspects of the data interest you?"
- "Is this normal?" → "What would you consider 'normal' for this flight?"

EXAMPLES OF GOOD AGENTIC BEHAVIOR:
❌ DON'T: "The flight shows some issues" (vague)
✅ DO: "I can see several potential issues. To give you the most helpful analysis, could you clarify: Are you most concerned about GPS accuracy, flight stability, or something else specific?"

❌ DON'T: "The altitude data looks normal" (assumption)
✅ DO: "I can analyze the altitude data, but I need to know: What altitude range would you consider 'normal' for this type of flight? Are you looking for specific altitude thresholds?"

❌ DON'T: "There are some anomalies" (unclear)
✅ DO: "I've identified several data patterns that could be anomalies. To focus my analysis, could you tell me: What type of issues are you most concerned about - sensor errors, flight performance, or data quality?"

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

1. getDataSchema() - ALWAYS check this FIRST to see what fields exist
2. getMessageTypes() - See what data types are available
3. queryData(sql) - Execute SQL queries to get exact results

🚨 REQUIRED WORKFLOW:
- ALWAYS start with getDataSchema() to see available fields
- NEVER query for fields that don't exist in the schema
- If you need to check data availability, use getDataSchema() first
- SPECIFICALLY: If asked about battery temperature, check getDataSchema() first - there is NO 'Temp' field in XKF4 tables
- AFTER calling getDataSchema(), you MUST explicitly state whether the field you're looking for exists or not
- If the field doesn't exist, say "ANSWER: This data is not available in the logs" and explain why
- CRITICAL: You MUST list the ACTUAL fields returned by getDataSchema() and explicitly state if your target field is missing
- NEVER claim fields exist that are not in the actual schema response

EXAMPLE USAGE:
- To check available data: Use getDataSchema() first
- To find maximum altitude: Use queryData("SELECT MAX(Alt) FROM gps_0_data")
- To count records: Use queryData("SELECT COUNT(*) FROM att_data")

⚠️ IMPORTANT: Always use the tools to get real data. Do not make up numbers or results!

🚨 ANTI-HALLUCINATION RULES:
- NEVER make up data that doesn't exist
- ALWAYS use getDataSchema() FIRST to see what fields are actually available
- If a field doesn't exist, say "ANSWER: This data is not available in the logs"
- If you're unsure, say "ANSWER: I need to check the available data first"
- NEVER invent field names like 'Temp', 'Battery', etc. - only use fields that exist
- If you get a database error, it means the field/table doesn't exist - say so
- Use getMessageTypes() to see what data types are available before querying
- After checking getDataSchema(), if the field you need is NOT in the list, say "ANSWER: This data is not available in the logs"
- NEVER claim to have found data that doesn't exist in the schema
- CRITICAL: When you call getDataSchema(), you MUST list the actual fields returned and acknowledge if the field you're looking for is missing

📊 DUCKDB COMPATIBILITY NOTES:
- Use PERCENTILE(0.5) instead of PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY column)
- Use time_boot_ms (not TimeUS) for timestamps
- Use Alt for altitude, Roll for roll, Pitch for pitch
- All tables have time_boot_ms as the primary time column

🚨 SCHEMA TRUTH:
- XKF4 tables contain: time_boot_ms, C, SV, SP, SH, SM, SVT, errRP, OFN, OFE, FS, TS, SS, GPS, PI
- XKF4 tables do NOT contain: Temp, Battery, Temperature, or any temperature-related fields
- If you see getDataSchema() results, trust ONLY those fields, not your training data`;

        return prompt;
    }

    parseAIResponse(response, validationResult) {
        console.log('🔍 parseAIResponse input:', response.substring(0, 300) + '...');
        
        // Use the intelligent validation result to parse the response
        if (validationResult && validationResult.parsedContent) {
            const { answer, reasoning, clarification } = validationResult.parsedContent;
            
            if (validationResult.outcome === 'CLARIFICATION') {
                console.log('✅ Response is asking for clarification');
                // Extract the actual clarification question from the response
                const clarificationMatch = response.match(/(?:could you|can you|would you|please|what|which|are you|do you).*?\?/i);
                const extractedClarification = clarificationMatch ? clarificationMatch[0].trim() : response;
                
                return {
                    finalAnswer: extractedClarification,
                    reasoning: response,
                    isClarification: true
                };
            }
            
            if (validationResult.outcome === 'ANSWER') {
                console.log('✅ Response provides concrete answer');
                // Extract the actual answer from the response
                const answerMatch = response.match(/ANSWER:\s*(.*?)(?=\nREASONING:|$)/s);
                const extractedAnswer = answerMatch ? answerMatch[1].trim() : response;
                
                return {
                    finalAnswer: extractedAnswer,
                    reasoning: response
                };
            }
            
            if (validationResult.outcome === 'REASONING') {
                console.log('⚠️ Response contains reasoning, extracting main point');
                // Try to extract a concise answer from the first paragraph
                const paragraphs = response.split('\n\n');
                const firstParagraph = paragraphs[0] || response;
                
                // Find the first sentence that looks like a direct statement
                const sentences = firstParagraph.split(/[.!?]+/);
                const directStatement = sentences.find(sentence => 
                    sentence.trim().length > 10 && 
                    sentence.trim().length < 200 &&
                    !sentence.includes('I will') &&
                    !sentence.includes('Let me') &&
                    !sentence.includes('To determine') &&
                    !sentence.includes('Based on')
                );
                
                return {
                    finalAnswer: directStatement ? directStatement.trim() + '.' : response,
                    reasoning: response
                };
            }
        }
        
        // Fallback: if no validation result, treat as general response
        console.log('⚠️ No validation result, using response as-is');
        return {
            finalAnswer: response,
            reasoning: response
        };
    }

    async getAIResponse(prompt, availableTools = []) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4o",
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
            model: "gpt-4o",
            messages: messages,
            max_tokens: 1000,
            temperature: 0.7
        });
        
        return finalResponse.choices[0].message.content;
    }
}

module.exports = ChatbotService;

