// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testToolCallingPreservation() {
    console.log('🧪 Testing Tool Calling Preservation During Corrections...');
    
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
        
        // Test: Ask a question that should trigger answer validation and correction
        // but still preserve tool calling
        console.log('\n🔍 Test: Tool Calling During Answer Correction');
        const response = await chatbotService.processMessage(
            "What are the GPS errors in this flight?", 
            sessionId
        );
        
        console.log('\n📊 Final Response:');
        console.log('Answer:', response.response);
        console.log('Thinking:', response.thinking);
        console.log('Answer Validation:', response.answerValidation);
        console.log('Query Validation:', response.queryValidation);
        
        // Check if the answer contains actual data (not hallucinated)
        if (response.response.includes('1448') || response.response.includes('feet') || 
            response.response.includes('GPS') || response.response.includes('HDop')) {
            console.log('✅ SUCCESS: Response contains real data from tool calls');
        } else {
            console.log('❌ FAILURE: Response appears to be hallucinated');
        }
        
        console.log('\n✅ Tool calling preservation test completed!');
        
    } catch (error) {
        console.error('❌ Tool calling preservation test failed:', error);
        console.error(error.stack);
    }
}

testToolCallingPreservation();
