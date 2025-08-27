const LogDataProcessor = require('./src/services/logDataProcessor');
const fs = require('fs');

async function testDuckDB() {
    console.log('🧪 Testing DuckDB integration...');
    
    try {
        // Initialize the processor
        const processor = new LogDataProcessor();
        await processor.initialize();
        
        // Load test data
        console.log('📂 Loading test data...');
        const testData = JSON.parse(fs.readFileSync('./test_data.json', 'utf8'));
        
        // Process the data
        console.log('🔄 Processing log data...');
        const result = await processor.processLogData(testData);
        
        console.log('✅ Processing result:', {
            totalMessageTypes: result.totalMessageTypes,
            processedTables: result.processedTables.length,
            errors: result.errors.length
        });
        
        // Get available tables
        const tables = await processor.getAvailableTables();
        console.log('📊 Available tables:', tables);
        
        // Get data schema
        const schema = await processor.getDataSchema();
        console.log('🔍 Data schema:', Object.keys(schema));
        
        // Test some queries
        console.log('🔍 Testing queries...');
        
        // Test ATT table
        if (schema.ATT) {
            const attSample = await processor.getSampleData(schema.ATT.tableName, 3);
            console.log('📊 ATT sample data:', attSample);
            
            const maxRoll = await processor.query(`SELECT MAX(roll) as max_roll FROM ${schema.ATT.tableName}`);
            console.log('📈 Max roll:', maxRoll);
        }
        
        // Test GPS table
        if (schema['GPS[0]']) {
            const gpsSample = await processor.getSampleData(schema['GPS[0]'].tableName, 3);
            console.log('📊 GPS sample data:', gpsSample);
            
            const maxAlt = await processor.query(`SELECT MAX(alt) as max_alt FROM ${schema['GPS[0]'].tableName}`);
            console.log('📈 Max altitude:', maxAlt);
        }
        
        // Clean up
        await processor.close();
        console.log('✅ Test completed successfully!');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testDuckDB();
