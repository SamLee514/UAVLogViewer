// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testToolCalling() {
    console.log('🧪 Testing True Tool Calling System...');
    
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
        
        // Test 1: Simple query that should trigger tool calling
        console.log('\n🔍 Test 1: Maximum Altitude Query');
        const response1 = await chatbotService.processMessage(
            "What is the maximum altitude reached during this flight?", 
            sessionId
        );
        
        console.log('Response 1:', {
            answer: response1.response,
            thinking: response1.thinking,
            queryValidation: response1.queryValidation
        });
        
        // Test 2: Complex analysis that should use multiple tools
        console.log('\n🔍 Test 2: Complex Flight Analysis');
        const response2 = await chatbotService.processMessage(
            "Analyze this flight. What are the key statistics including max altitude, average roll, and total GPS records?", 
            sessionId
        );
        
        console.log('Response 2:', {
            answer: response2.response,
            thinking: response2.thinking,
            queryValidation: response2.queryValidation
        });
        
        // Test 3: Schema exploration
        console.log('\n🔍 Test 3: Data Schema Exploration');
        const response3 = await chatbotService.processMessage(
            "What data tables are available and what fields do they contain?", 
            sessionId
        );
        
        console.log('Response 3:', {
            answer: response3.response,
            thinking: response3.thinking,
            queryValidation: response3.queryValidation
        });
        
        console.log('\n✅ Tool calling test completed!');
        
    } catch (error) {
        console.error('❌ Tool calling test failed:', error);
        console.error(error.stack);
    }
}

testToolCalling();
