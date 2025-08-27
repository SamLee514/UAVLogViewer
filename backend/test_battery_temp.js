// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testBatteryTemp() {
    console.log('🧪 Testing Battery Temperature Anti-Hallucination...');
    
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
        
        // Test: Battery temperature question (should NOT hallucinate)
        console.log('\n🔍 Testing Battery Temperature Question...');
        const response = await chatbotService.processMessage(
            "What was the maximum battery temperature?", 
            sessionId
        );
        
        console.log('\n📋 Response Analysis:');
        console.log('Answer:', response.response);
        console.log('Thinking:', response.thinking);
        console.log('Has Query Validation:', !!response.queryValidation);
        
        // Check if the response contains hallucinated data
        const hasTempField = response.response.includes('Temp') || response.thinking.includes('Temp');
        const hasBatteryTemp = response.response.includes('battery temperature') || response.thinking.includes('battery temperature');
        const hasFakeNumber = /\d+\.?\d*°?C/.test(response.response) || /\d+\.?\d*°?C/.test(response.thinking);
        
        console.log('\n🔍 Hallucination Check:');
        console.log('Mentions "Temp" field:', hasTempField);
        console.log('Mentions "battery temperature":', hasBatteryTemp);
        console.log('Contains fake temperature number:', hasFakeNumber);
        
        if (hasTempField || hasBatteryTemp || hasFakeNumber) {
            console.log('❌ STILL HALLUCINATING - The LLM is making up data!');
        } else {
            console.log('✅ SUCCESS - No hallucination detected!');
        }
        
        console.log('\n✅ Battery temperature test completed!');
        
    } catch (error) {
        console.error('❌ Battery temperature test failed:', error);
        console.error(error.stack);
    }
}

testBatteryTemp();
