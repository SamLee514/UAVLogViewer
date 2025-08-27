// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testAgenticBehavior() {
    console.log('🧪 Testing Agentic Behavior and Clarification Requests...');
    
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
        
        // Test 1: Vague question that should trigger clarification request
        console.log('\n🔍 Test 1: Vague Question (Should Ask for Clarification)');
        const response1 = await chatbotService.processMessage(
            "Are there any issues with this flight?", 
            sessionId
        );
        
        console.log('Response 1:', {
            answer: response1.response,
            thinking: response1.thinking,
            answerValidation: response1.answerValidation
        });
        
        // Check if response asks for clarification
        const isAskingForClarification = response1.response.toLowerCase().includes('clarify') || 
                                       response1.response.toLowerCase().includes('could you') ||
                                       response1.response.toLowerCase().includes('need to know') ||
                                       response1.response.toLowerCase().includes('?');
        
        if (isAskingForClarification) {
            console.log('✅ SUCCESS: Bot asked for clarification instead of being vague');
        } else {
            console.log('⚠️  WARNING: Bot may not have asked for clarification');
        }
        
        // Test 2: Ambiguous question that should trigger clarification
        console.log('\n🔍 Test 2: Ambiguous Question (Should Ask for Clarification)');
        const response2 = await chatbotService.processMessage(
            "How does the data look?", 
            sessionId
        );
        
        console.log('Response 2:', {
            answer: response2.response,
            thinking: response2.thinking,
            answerValidation: response2.answerValidation
        });
        
        // Check if response asks for clarification
        const isAskingForClarification2 = response2.response.toLowerCase().includes('clarify') || 
                                        response2.response.toLowerCase().includes('could you') ||
                                        response2.response.toLowerCase().includes('need to know') ||
                                        response2.response.toLowerCase().includes('?');
        
        if (isAskingForClarification2) {
            console.log('✅ SUCCESS: Bot asked for clarification instead of being vague');
        } else {
            console.log('⚠️  WARNING: Bot may not have asked for clarification');
        }
        
        // Test 3: Specific question that should get a concrete answer
        console.log('\n🔍 Test 3: Specific Question (Should Get Concrete Answer)');
        const response3 = await chatbotService.processMessage(
            "What is the maximum altitude reached during this flight?", 
            sessionId
        );
        
        console.log('Response 3:', {
            answer: response3.response,
            thinking: response3.thinking,
            answerValidation: response3.answerValidation
        });
        
        // Check if response provides concrete data
        const hasConcreteData = response3.response.includes('1448') || 
                               response3.response.includes('meters') ||
                               response3.response.includes('feet') ||
                               response3.response.includes('altitude');
        
        if (hasConcreteData) {
            console.log('✅ SUCCESS: Bot provided concrete data for specific question');
        } else {
            console.log('⚠️  WARNING: Bot may not have provided concrete data');
        }
        
        console.log('\n✅ Agentic behavior test completed!');
        
    } catch (error) {
        console.error('❌ Agentic behavior test failed:', error);
        console.error(error.stack);
    }
}

testAgenticBehavior();
