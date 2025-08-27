// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testAltitudeAccuracy() {
    console.log('🧪 Testing Altitude Accuracy with Tool Calling...');
    
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
        
        // Test: Ask about maximum altitude - this should use tool calls and return real data
        console.log('\n🔍 Test: Maximum Altitude with Tool Calling');
        const response = await chatbotService.processMessage(
            "What is the maximum altitude reached during this flight?", 
            sessionId
        );
        
        console.log('\n📊 Final Response:');
        console.log('Answer:', response.response);
        console.log('Thinking:', response.thinking);
        console.log('Answer Validation:', response.answerValidation);
        console.log('Query Validation:', response.queryValidation);
        
        // Check if the answer contains the correct altitude (should be around 1448 feet)
        if (response.response.includes('1448') || response.response.includes('1448.0')) {
            console.log('✅ SUCCESS: Response contains correct altitude (1448 feet) from tool calls');
        } else if (response.response.includes('3000') || response.response.includes('4200')) {
            console.log('❌ FAILURE: Response contains hallucinated altitude values');
        } else {
            console.log('⚠️  WARNING: Response altitude value unclear - may need investigation');
        }
        
        // Check if tool calls were made
        if (response.thinking && response.thinking.includes('query') && 
            (response.thinking.includes('SELECT') || response.thinking.includes('MAX'))) {
            console.log('✅ SUCCESS: Response indicates tool calls were made');
        } else {
            console.log('⚠️  WARNING: Response may not indicate tool calls were used');
        }
        
        console.log('\n✅ Altitude accuracy test completed!');
        
    } catch (error) {
        console.error('❌ Altitude accuracy test failed:', error);
        console.error(error.stack);
    }
}

testAltitudeAccuracy();
