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

    /**
     * Parse AI response using a second LLM to extract answer and reasoning
     * @param {string} response - The AI response text
     * @returns {object} Parsed response with thinking and finalAnswer
     */
    async parseAIResponse(response) {
        try {
            const parsingPrompt = `You are a response parser for a UAV telemetry chatbot. Your job is to parse the AI's response and extract the answer and reasoning.

IMPORTANT: You have a BIAS TOWARD PRESERVING ANSWERS. Even if there are tool errors or issues, if there's a valid answer in the response, extract it.

RESPONSE TO PARSE:
${response}

TASK: Parse this response into a structured format. Look for:

1. ANSWER: The actual answer to the user's question (concrete facts, numbers, conclusions)
2. REASONING: The data source, tool calls used, or explanation of how the answer was derived
3. ISSUES: Any tool errors, SQL problems, or technical issues that occurred

PARSING RULES:
- If there's a valid answer, prioritize extracting it even if there are tool errors
- If the response asks for clarification, mark it as a clarification request
- If there are SQL errors but also valid data, still extract the valid answer
- If there are tool failures but the LLM provides reasonable conclusions, preserve them
- Be generous in what you consider a "valid answer" - partial answers are better than nothing
- IF YOU CANNOT FIND AN ANSWER, default to asking for clarification. If "No answer provided" is the only thing you can find, ask for clarification.
- PREFER SPECIFIC NUMBERS! If you can quantify and specify values, do so. Prefer NOT to just say "there were multiple issues".
- Human readable responses are better! Don't just provide something like "{ SV: 0, SP: 0, SH: 0.05, SM: 0 }" without explaining what it means.

RESPONSE FORMAT (JSON only):
{
  "finalAnswer": "The actual answer to the user's question, a question for the user, or null if no answer",
  "thinking": "Data source, tool calls, reasoning, or explanation of the answer",
  "responseType": "answer|clarification|error|partial",
  "issues": ["List any tool errors, SQL problems, or technical issues found"],
  "hasValidAnswer": true/false
}

EXAMPLES:

Example 1 - Good answer with data:
"ANSWER: The maximum altitude was 150 meters. DATA SOURCE: Used queryData('SELECT MAX(Alt) FROM gps_0_data')"
→ {"finalAnswer": "The maximum altitude was 150 meters", "thinking": "Data Source: Used queryData('SELECT MAX(Alt) FROM gps_0_data')", "responseType": "answer", "issues": [], "hasValidAnswer": true}

Example 2 - Answer with tool error:
"ANSWER: The maximum altitude was 150 meters. However, there was an error with the GPS query: table 'gps_data' not found. I used the available altitude data from the attitude logs instead."
→ {"finalAnswer": "The maximum altitude was 150 meters", "thinking": "Used altitude data from attitude logs. GPS query failed due to table 'gps_data' not found.", "responseType": "partial", "issues": ["GPS table 'gps_data' not found"], "hasValidAnswer": true}

Example 3 - Clarification request:
"CLARIFICATION: What specific aspects of the flight data would you like me to analyze? REASON: Your question is too broad for me to provide a focused answer."
→ {"finalAnswer": "What specific aspects of the flight data would you like me to analyze?", "thinking": "Reason: Your question is too broad for me to provide a focused answer.", "responseType": "clarification", "issues": [], "hasValidAnswer": false}

Example 4 - Complete failure:
"I encountered an error while processing your request. The database connection failed."
→ {"finalAnswer": null, "thinking": "Database connection failed, unable to process request", "responseType": "error", "issues": ["Database connection failed"], "hasValidAnswer": false}

!!!AGAIN, THIS IS IMPORTANT. IF YOU DON'T FIND AN ANSWER, ASK FOR CLARIFICATION!!!

Parse the response above:`;

            const completion = await this.openai.chat.completions.create({
                model: "gpt-4o-mini", // Use cheaper model for parsing
                messages: [
                    {
                        role: "system",
                        content: "You are a precise response parser. Respond only with valid JSON matching the exact format specified."
                    },
                    {
                        role: "user",
                        content: parsingPrompt
                    }
                ],
                max_tokens: 300,
                temperature: 0.1
            });

            const parsedResult = JSON.parse(completion.choices[0].message.content);
            
            console.log('🔍 LLM parsing result:', parsedResult);
            
            // Validate the parsed result has required fields
            if (!parsedResult.finalAnswer && !parsedResult.thinking) {
                console.warn('⚠️ LLM parser returned incomplete result, falling back to regex');
                return this.fallbackRegexParse(response);
            }
            
            return {
                finalAnswer: parsedResult.finalAnswer || 'I had some trouble understanding that. Could you clarify?',
                thinking: parsedResult.thinking || 'No reasoning provided',
                responseType: parsedResult.responseType || 'unknown',
                issues: parsedResult.issues || [],
                hasValidAnswer: parsedResult.hasValidAnswer || false
            };
            
        } catch (error) {
            console.error('❌ Error with LLM parsing:', error);
            console.log('🔄 Falling back to regex parsing...');
            return this.fallbackRegexParse(response);
        }
    }

    /**
     * Fallback regex parsing method for when LLM parsing fails
     * @param {string} response - The AI response text
     * @returns {object} Parsed response with thinking and finalAnswer
     */
    fallbackRegexParse(response) {
        try {
            // Look for ANSWER: and DATA SOURCE: patterns
            const answerMatch = response.match(/ANSWER:\s*(.*?)(?=\n|DATA SOURCE:|CLARIFICATION:|$)/s);
            const dataSourceMatch = response.match(/DATA SOURCE:\s*(.*?)(?=\n|CLARIFICATION:|$)/s);
            const clarificationMatch = response.match(/CLARIFICATION:\s*(.*?)(?=\n|REASON:|$)/s);
            const reasonMatch = response.match(/REASON:\s*(.*?)(?=\n|$)/s);

            if (answerMatch && dataSourceMatch) {
                // This is an answer with data
                const answer = answerMatch[1].trim();
                const dataSource = dataSourceMatch[1].trim();
                
                return {
                    finalAnswer: answer,
                    thinking: `Data Source: ${dataSource}`,
                    responseType: 'answer',
                    issues: [],
                    hasValidAnswer: true
                };
            } else if (clarificationMatch && reasonMatch) {
                // This is a clarification request
                const clarification = clarificationMatch[1].trim();
                const reason = reasonMatch[1].trim();
                
                return {
                    finalAnswer: clarification,
                    thinking: `Reason: ${reason}`,
                    responseType: 'clarification',
                    issues: [],
                    hasValidAnswer: false
                };
            } else if (clarificationMatch) {
                // Just clarification without reason
                const clarification = clarificationMatch[1].trim();
                
                return {
                    finalAnswer: clarification,
                    thinking: 'Clarification requested',
                    responseType: 'clarification',
                    issues: [],
                    hasValidAnswer: false
                };
            } else {
                // Fallback: treat entire response as answer
                return {
                    finalAnswer: response.trim(),
                    thinking: null,
                    responseType: 'fallback',
                    issues: [],
                    hasValidAnswer: true
                };
            }
        } catch (error) {
            console.error('❌ Error in fallback regex parsing:', error);
            // Final fallback: return response as-is
            return {
                finalAnswer: response.trim(),
                thinking: 'Parsing failed, showing full response',
                responseType: 'error',
                issues: ['Response parsing failed'],
                hasValidAnswer: true
            };
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
            
            // Parse the AI response into structured format
            const parsedResponse = await this.parseAIResponse(response);
            
            // Validate the response by executing any mentioned queries
            console.log('🔍 Validating LLM response for query accuracy...');
            const validationResult = await this.queryValidator.validateResponse(response);
            
            // Add AI response to session history
            this.addToHistory(sessionId, 'assistant', response);
            
            // Simple response handling - no second LLM validation
            let finalResponse = response;
            let finalParsedResponse = parsedResponse;
            let correctiveFeedback = '';
            
            // Only handle query validation corrections (no answer quality validation)
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
                    finalParsedResponse = await this.parseAIResponse(correctedResponse);
                }
            }
            
            console.log('🔍 Final AI response:', {
                original: response.substring(0, 500) + '...',
                final: finalResponse.substring(0, 500) + '...',
                originalLength: response.length,
                finalLength: finalResponse.length,
                parsed: finalParsedResponse
            });
            
            return {
                response: finalParsedResponse.finalAnswer,
                thinking: finalParsedResponse.thinking,
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
                    wasCorrected: false, // No more answer validation
                    correctionAttempts: 0,
                    originalResponse: null
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

🚨 CRITICAL DECISION TREE - You MUST choose ONE path:

PATH 1: ANSWER WITH DATA
- If you can answer the question using available data → USE TOOLS to get real data
- Execute getDataSchema() first, then queryData() for specific values
- Provide a concrete, data-driven answer

PATH 2: ASK FOR CLARIFICATION  
- If the question is vague, ambiguous, or unclear → ASK SPECIFIC clarifying questions
- Do NOT provide reasoning or analysis without data
- Do NOT end with "I will analyze" or similar statements

🚨 IMMEDIATE ACTION REQUIRED:
- NO planning statements like "I will now..." or "Let me..."
- NO descriptions of what you're about to do
- NO "I will execute the tool" - JUST EXECUTE IT
- NO "I will analyze" - JUST ANALYZE AND ANSWER
- START IMMEDIATELY with tool calls or clarification questions

🚨 FORBIDDEN RESPONSES:
❌ "I will analyze the data to find..."
❌ "Let me examine the logs..."
❌ "Based on the available data..."
❌ "To determine if there are issues..."
❌ "I will now execute the tool..."
❌ "I will use the tool to..."
❌ "Let me use the tool..."
❌ Any response that ends with reasoning instead of action
❌ Any response that describes what you WILL do instead of doing it

🚨 REQUIRED RESPONSE FORMAT:

FOR ANSWERS WITH DATA:
ANSWER: [Concrete, specific answer with actual numbers/values from tools]
DATA SOURCE: [List the specific tool calls and results used]

FOR CLARIFICATION REQUESTS:
CLARIFICATION: [Specific, direct question about what the user wants to know]
REASON: [Brief explanation of why clarification is needed]

🚨 TOOL USAGE ENFORCEMENT:
- ALWAYS start with getDataSchema() to see available fields
- If you need specific data → USE queryData() immediately
- If you can't get the needed data → ASK for clarification
- NEVER speculate or provide reasoning without data
- NEVER say "I will use the tool" - JUST USE IT
- NEVER say "Let me execute the tool" - JUST EXECUTE IT
- NEVER describe your plan - JUST DO IT

🚨 CLARIFICATION TRIGGERS - ASK FOR CLARIFICATION WHEN:
- Question is vague: "Are there any issues?" → Ask: "What specific issues concern you?"
- Question is ambiguous: "How does the data look?" → Ask: "What aspects interest you?"
- Question lacks context: "Is this normal?" → Ask: "What would you consider 'normal'?"
- Question is too broad: "Analyze the flight" → Ask: "What specific aspects should I focus on?"

IF ASKED ABOUT ANOMALY DETECTION OR ISSUES, look for sudden changes in altitude, battery voltage, or inconsistent GPS lock, etc.

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
            prompt += `\n📚 CONVERSATION HISTORY (Last 10 messages):\n`;
            sessionHistory.slice(-10).forEach((msg, index) => {
                const role = msg.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
                prompt += `\n--- Message ${index + 1} ---\n`;
                prompt += `${role}: ${msg.content}\n`;
            });
            prompt += `\n--- End History ---\n`;
        }

        prompt += `\n🚨 FINAL INSTRUCTION:
You MUST choose ONE path:
1. Use tools to get data and provide ANSWER + DATA SOURCE, OR  
2. Ask for CLARIFICATION + REASON

NO OTHER OPTIONS. NO REASONING WITHOUT DATA. NO "I WILL ANALYZE" STATEMENTS.

🚨 AVAILABLE TOOLS:
- getDataSchema() - Check available fields FIRST
- getMessageTypes() - See available data types  
- queryData(sql) - Execute SQL queries for real data

🚨 REMEMBER: Either answer with real data from tools, or ask for clarification. Nothing else.

🚨 CRITICAL: DO NOT DESCRIBE YOUR ACTIONS - JUST DO THEM:
- ❌ "I will now use getDataSchema() to check available fields"
- ✅ Just call getDataSchema() directly
- ❌ "Let me execute the query to get the data"
- ✅ Just call queryData() directly
- ❌ "I will analyze the results"
- ✅ Just provide the answer based on the results

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
- If you see getDataSchema() results, trust ONLY those fields, not your training data

🚨 FINAL REMINDER:
- NO "I will now..." statements
- NO "Let me..." statements  
- NO planning or describing actions
- JUST DO IT: Call tools directly or ask clarification
- START IMMEDIATELY with action, not description`;

        return prompt;
    }

    async getAIResponse(prompt, availableTools = []) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert UAV telemetry analyst with deep knowledge of ArduPilot systems. Your primary goal is to provide direct, actionable answers to user questions about their flight data. When analyzing logs, be confident and decisive - don't ask for clarification unless absolutely necessary. Use the available log data to provide concrete answers. CRITICAL: NO planning statements like 'I will now...' or 'Let me...' - just execute tools directly or ask clarification immediately."
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
                content: "You are an expert UAV telemetry analyst. Use the tool results to provide accurate answers. Remember to format your response with ANSWER: and DATA SOURCE: sections as specified in the original prompt."
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
        
        // Parse the final response to ensure consistent formatting
        const parsedResponse = await this.parseAIResponse(finalResponse.choices[0].message.content);
        
        // Return the parsed final answer
        return parsedResponse.finalAnswer;
    }
}

module.exports = ChatbotService;

