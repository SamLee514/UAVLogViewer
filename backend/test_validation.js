const QueryValidator = require('./src/services/queryValidator');
const LogDataProcessor = require('./src/services/logDataProcessor');

async function testQueryValidation() {
    console.log('🧪 Testing Query Validation System...');
    
    try {
        // Initialize the processor
        const processor = new LogDataProcessor();
        await processor.initialize();
        
        // Initialize the query validator
        const validator = new QueryValidator(processor);
        
        // Load test data
        console.log('📂 Loading test data...');
        const testData = require('./test_data.json');
        
        // Process the data
        console.log('🔄 Processing log data...');
        const result = await processor.processLogData(testData);
        
        console.log('✅ Processing result:', {
            totalMessageTypes: result.totalMessageTypes,
            processedTables: result.processedTables.length,
            errors: result.errors.length
        });
        
        // Test 1: Valid LLM response (should pass validation)
        console.log('\n🔍 Test 1: Valid LLM Response');
        const validResponse = `The maximum altitude was found by executing SELECT MAX(Alt) FROM gps_0_data, which returned 1447.98 meters. This represents the highest point reached during the flight.`;
        
        const validValidation = await validator.validateResponse(validResponse);
        console.log('Validation result:', validValidation);
        
        // Test 2: Invalid LLM response (should fail validation)
        console.log('\n🔍 Test 2: Invalid LLM Response (with wrong numbers)');
        const invalidResponse = `The maximum altitude was found by executing SELECT MAX(Alt) FROM gps_0_data, which returned 3147 meters. This represents the highest point reached during the flight.`;
        
        const invalidValidation = await validator.validateResponse(invalidResponse);
        console.log('Validation result:', invalidValidation);
        
        // Test 3: LLM response with multiple queries
        console.log('\n🔍 Test 3: Multiple Queries Response');
        const multiQueryResponse = `I analyzed the flight data using several queries:

1. SELECT MAX(Alt) FROM gps_0_data returned 1447.98 meters for maximum altitude
2. SELECT MIN(Alt) FROM gps_0_data returned -17 meters for minimum altitude  
3. SELECT AVG(Alt) FROM gps_0_data returned 160.93 meters for average altitude

The flight had a total altitude range of 1464.98 meters.`;
        
        const multiValidation = await validator.validateResponse(multiQueryResponse);
        console.log('Validation result:', multiValidation);
        
        // Test 4: LLM response with mixed correct/incorrect data
        console.log('\n🔍 Test 4: Mixed Correct/Incorrect Response');
        const mixedResponse = `I analyzed the flight data using several queries:

1. SELECT MAX(Alt) FROM gps_0_data returned 1447.98 meters for maximum altitude
2. SELECT MIN(Alt) FROM gps_0_data returned -17 meters for minimum altitude  
3. SELECT COUNT(*) FROM gps_0_data WHERE Alt > 1000 returned 500 records (incorrect!)

The flight had significant high-altitude segments.`;
        
        const mixedValidation = await validator.validateResponse(mixedResponse);
        console.log('Validation result:', mixedValidation);
        
        // Show query history
        console.log('\n📊 Query Execution History:');
        const history = validator.getQueryHistory();
        history.forEach((query, index) => {
            console.log(`${index + 1}. ${query.sql}`);
            console.log(`   Success: ${query.success}`);
            if (query.success) {
                console.log(`   Result: ${JSON.stringify(query.result[0])}`);
                console.log(`   Execution time: ${query.executionTime}ms`);
            } else {
                console.log(`   Error: ${query.error}`);
            }
        });
        
        // Clean up
        await processor.close();
        console.log('\n✅ Query validation test completed!');
        
    } catch (error) {
        console.error('❌ Query validation test failed:', error);
        console.error(error.stack);
    }
}

testQueryValidation();
