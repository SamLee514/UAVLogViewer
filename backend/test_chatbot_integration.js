// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testChatbotIntegration() {
    console.log('🧪 Testing Chatbot Integration with Tool Calling...');
    
    try {
        // Initialize the chatbot service
        const chatbotService = new ChatbotService();
        
        // Initialize the service first
        console.log('🔧 Initializing chatbot service...');
        await chatbotService.initialize();
        
        // Load test data
        const testData = require('./test_data.json');
        
        // Initialize session with test data
        console.log('📂 Initializing session with test data...');
        const sessionResult = await chatbotService.initializeSession(testData);
        
        if (!sessionResult.success) {
            throw new Error(`Failed to initialize session: ${sessionResult.error}`);
        }
        
        const sessionId = sessionResult.sessionId;
        console.log(`✅ Session initialized successfully with ID: ${sessionId}`);
        
        // Test 1: Simple question that should trigger tool calling
        console.log('\n🔍 Test 1: Simple Question with Tool Calling');
        const response1 = await chatbotService.processMessage(
            "What is the maximum altitude reached during this flight?", 
            sessionId
        );
        
        console.log('Response 1:', {
            answer: response1.response,
            thinking: response1.thinking,
            hasQueryValidation: !!response1.queryValidation,
            queryValidation: response1.queryValidation
        });
        
        // Test 2: Complex analysis question
        console.log('\n🔍 Test 2: Complex Analysis Question');
        const response2 = await chatbotService.processMessage(
            "Analyze the flight performance. What are the key statistics including altitude range, attitude variations, and any anomalies?", 
            sessionId
        );
        
        console.log('Response 2:', {
            answer: response2.response,
            thinking: response2.thinking,
            hasQueryValidation: !!response2.queryValidation,
            queryValidation: response2.queryValidation
        });
        
        // Test 3: Data exploration question
        console.log('\n🔍 Test 3: Data Exploration Question');
        const response3 = await chatbotService.processMessage(
            "What data tables are available and what can I analyze with them?", 
            sessionId
        );
        
        console.log('Response 3:', {
            answer: response3.response,
            thinking: response3.thinking,
            hasQueryValidation: !!response3.queryValidation,
            queryValidation: response3.queryValidation
        });
        
        // Test 4: Get data schema
        console.log('\n🔍 Test 4: Data Schema Retrieval');
        const dataSchema = await chatbotService.logDataProcessor.getDataSchema();
        const availableTables = await chatbotService.logDataProcessor.getAvailableTables();
        
        console.log('Data Schema:', {
            availableTables: availableTables.length,
            tableNames: availableTables.map(t => t.tableName),
            hasDataSchema: !!dataSchema
        });
        
        // Test 5: Direct SQL query execution
        console.log('\n🔍 Test 5: Direct SQL Query Execution');
        const queryResult = await chatbotService.logDataProcessor.query(
            'SELECT MAX(Alt) as max_altitude, MIN(Alt) as min_altitude, AVG(Alt) as avg_altitude FROM gps_0_data'
        );
        
        console.log('Direct Query Result:', queryResult);
        
        console.log('\n✅ Chatbot integration test completed!');
        
    } catch (error) {
        console.error('❌ Chatbot integration test failed:', error);
        console.error(error.stack);
    }
}

testChatbotIntegration();
