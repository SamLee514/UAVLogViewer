const QueryValidator = require('./src/services/queryValidator');
const LogDataProcessor = require('./src/services/logDataProcessor');

async function testDiscrepancyDetection() {
    console.log('🧪 Testing Discrepancy Detection...');
    
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
        
        // Test with a response that has the exact discrepancy from production
        console.log('\n🔍 Test: Production-like Discrepancy');
        const productionResponse = `The maximum altitude was found by executing SELECT MAX(Alt) FROM gps_0_data, which returned 3147 meters. This represents the highest point reached during the flight.`;
        
        const validation = await validator.validateResponse(productionResponse);
        console.log('Validation result:', validation);
        
        // Show the actual query results for comparison
        console.log('\n📊 Actual Query Results:');
        const maxAltResult = await processor.query('SELECT MAX(Alt) as max_altitude FROM gps_0_data');
        console.log('SELECT MAX(Alt) FROM gps_0_data:', maxAltResult);
        
        const minAltResult = await processor.query('SELECT MIN(Alt) as min_altitude FROM gps_0_data');
        console.log('SELECT MIN(Alt) FROM gps_0_data:', minAltResult);
        
        const avgAltResult = await processor.query('SELECT AVG(Alt) as avg_altitude FROM gps_0_data');
        console.log('SELECT AVG(Alt) FROM gps_0_data:', avgAltResult);
        
        // Test with another discrepancy
        console.log('\n🔍 Test: Another Discrepancy');
        const anotherResponse = `The average altitude was calculated using SELECT AVG(Alt) FROM gps_0_data, which returned 500 meters.`;
        
        const validation2 = await validator.validateResponse(anotherResponse);
        console.log('Validation result:', validation2);
        
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
        console.log('\n✅ Discrepancy detection test completed!');
        
    } catch (error) {
        console.error('❌ Discrepancy detection test failed:', error);
        console.error(error.stack);
    }
}

testDiscrepancyDetection();
