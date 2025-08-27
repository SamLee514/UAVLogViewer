const LogDataProcessor = require('./src/services/logDataProcessor');

async function testSimple() {
    console.log('🧪 Testing simple DuckDB operations...');
    
    try {
        // Initialize the processor
        const processor = new LogDataProcessor();
        await processor.initialize();
        
        // Test with just one message type
        const testData = {
            messages: {
                'ATT': {
                    'time_boot_ms': {
                        '0': 1000,
                        '1': 2000,
                        '2': 3000
                    },
                    'Roll': {
                        '0': 0.1,
                        '1': 0.2,
                        '2': 0.3
                    },
                    'Pitch': {
                        '0': -0.1,
                        '1': -0.2,
                        '2': -0.3
                    }
                }
            }
        };
        
        console.log('🔄 Processing simple test data...');
        const result = await processor.processLogData(testData);
        
        console.log('✅ Result:', result);
        
        // Test query
        const tables = await processor.getAvailableTables();
        console.log('📊 Tables:', tables);
        
        await processor.close();
        console.log('✅ Simple test completed!');
        
    } catch (error) {
        console.error('❌ Simple test failed:', error);
        console.error(error.stack);
    }
}

testSimple();
