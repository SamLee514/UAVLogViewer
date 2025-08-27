// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testFixes() {
    console.log('🧪 Testing Anti-Hallucination and Response Formatting Fixes...');
    
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
        
        // Test 1: Battery temperature question (should NOT hallucinate)
        console.log('\n🔍 Test 1: Battery Temperature Question (Anti-Hallucination Test)');
        const response1 = await chatbotService.processMessage(
            "What was the maximum battery temperature?", 
            sessionId
        );
        
        console.log('Response 1:', {
            answer: response1.response,
            thinking: response1.thinking,
            hasQueryValidation: !!response1.queryValidation,
            queryValidation: response1.queryValidation
        });
        
        // Test 2: Check if it uses tools to verify data availability
        console.log('\n🔍 Test 2: Data Availability Check');
        const response2 = await chatbotService.processMessage(
            "What fields are available in the XKF4 tables?", 
            sessionId
        );
        
        console.log('Response 2:', {
            answer: response2.response,
            thinking: response2.thinking,
            hasQueryValidation: !!response2.queryValidation,
            queryValidation: response2.queryValidation
        });
        
        // Test 3: Valid question that should work
        console.log('\n🔍 Test 3: Valid Question (Should Work)');
        const response3 = await chatbotService.processMessage(
            "What is the maximum altitude reached during this flight?", 
            sessionId
        );
        
        console.log('Response 3:', {
            answer: response3.response,
            thinking: response3.thinking,
            hasQueryValidation: !!response3.queryValidation,
            queryValidation: response3.queryValidation
        });
        
        console.log('\n✅ Fixes test completed!');
        
    } catch (error) {
        console.error('❌ Fixes test failed:', error);
        console.error(error.stack);
    }
}

testFixes();
