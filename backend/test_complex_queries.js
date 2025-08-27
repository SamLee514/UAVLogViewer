// Load environment variables
require('dotenv').config();

const ChatbotService = require('./src/services/chatbotService');

async function testComplexQueries() {
    console.log('🧪 Testing Complex, LLM-Invented Queries...');
    
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
        
        // Test 1: Complex time-based analysis
        console.log('\n🔍 Test 1: Complex Time-Based Analysis');
        const response1 = await chatbotService.processMessage(
            "Analyze the flight data during the first 30 seconds (0-30000ms). What was the maximum altitude, average roll, and how many GPS fixes were recorded during this period?", 
            sessionId
        );
        
        console.log('Response 1:', {
            answer: response1.response,
            thinking: response1.thinking,
            queryValidation: response1.queryValidation
        });
        
        // Test 2: Anomaly detection
        console.log('\n🔍 Test 2: Anomaly Detection');
        const response2 = await chatbotService.processMessage(
            "Are there any anomalies in this flight? Look for periods where the roll angle exceeded 20 degrees, pitch exceeded 15 degrees, or altitude changed by more than 100 meters in a short time.", 
            sessionId
        );
        
        console.log('Response 2:', {
            answer: response2.response,
            thinking: response2.thinking,
            queryValidation: response2.queryValidation
        });
        
        // Test 3: Statistical analysis
        console.log('\n🔍 Test 3: Statistical Analysis');
        const response3 = await chatbotService.processMessage(
            "Provide a comprehensive statistical analysis of this flight. Include percentiles for altitude, roll, and pitch, plus correlation analysis between GPS altitude and attitude data.", 
            sessionId
        );
        
        console.log('Response 3:', {
            answer: response3.response,
            thinking: response3.thinking,
            queryValidation: response3.queryValidation
        });
        
        // Test 4: Flight phase analysis
        console.log('\n🔍 Test 4: Flight Phase Analysis');
        const response4 = await chatbotService.processMessage(
            "Break down this flight into phases. Identify takeoff, cruise, and landing phases based on altitude changes, attitude variations, and GPS status. What are the key characteristics of each phase?", 
            sessionId
        );
        
        console.log('Response 4:', {
            answer: response4.response,
            thinking: response4.thinking,
            queryValidation: response4.queryValidation
        });
        
        // Test 5: Data quality assessment
        console.log('\n🔍 Test 5: Data Quality Assessment');
        const response5 = await chatbotService.processMessage(
            "Assess the quality of this flight data. Check for gaps in GPS coverage, unusual attitude readings, and data consistency issues. Are there any periods where the data quality degrades?", 
            sessionId
        );
        
        console.log('Response 5:', {
            answer: response5.response,
            thinking: response5.thinking,
            queryValidation: response5.queryValidation
        });
        
        console.log('\n✅ Complex query test completed!');
        
    } catch (error) {
        console.error('❌ Complex query test failed:', error);
        console.error(error.stack);
    }
}

testComplexQueries();
