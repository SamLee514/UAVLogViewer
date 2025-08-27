const LogDataProcessor = require('./src/services/logDataProcessor');

async function queryRealData() {
    console.log('🔍 Querying real data to verify LLM claims...');
    
    try {
        // Initialize the processor
        const processor = new LogDataProcessor();
        await processor.initialize();
        
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
        
        // Now let's query the actual data
        console.log('\n🔍 QUERYING ACTUAL DATA:');
        
        // Query GPS data for maximum altitude
        console.log('\n--- GPS Altitude Analysis ---');
        const maxAltQuery = 'SELECT MAX(Alt) as max_altitude FROM gps_0_data';
        const maxAltResult = await processor.query(maxAltQuery);
        console.log('Max altitude query result:', maxAltResult);
        
        // Query GPS data for minimum altitude
        const minAltQuery = 'SELECT MIN(Alt) as min_altitude FROM gps_0_data';
        const minAltResult = await processor.query(minAltQuery);
        console.log('Min altitude query result:', minAltResult);
        
        // Query GPS data for altitude range
        const altRangeQuery = 'SELECT MIN(Alt) as min_alt, MAX(Alt) as max_alt, AVG(Alt) as avg_alt FROM gps_0_data';
        const altRangeResult = await processor.query(altRangeQuery);
        console.log('Altitude range query result:', altRangeResult);
        
        // Query GPS data for sample altitude values
        const sampleAltQuery = 'SELECT time_boot_ms, Alt FROM gps_0_data ORDER BY time_boot_ms LIMIT 10';
        const sampleAltResult = await processor.query(sampleAltQuery);
        console.log('Sample altitude values (first 10):', sampleAltResult);
        
        // Query GPS data for altitude values over 1000m
        const highAltQuery = 'SELECT COUNT(*) as high_alt_count FROM gps_0_data WHERE Alt > 1000';
        const highAltResult = await processor.query(highAltQuery);
        console.log('Altitude values over 1000m count:', highAltResult);
        
        // Query GPS data for altitude values over 2000m
        const veryHighAltQuery = 'SELECT COUNT(*) as very_high_alt_count FROM gps_0_data WHERE Alt > 2000';
        const veryHighAltResult = await processor.query(veryHighAltQuery);
        console.log('Altitude values over 2000m count:', veryHighAltResult);
        
        // Query GPS data for altitude values over 3000m
        const extremeAltQuery = 'SELECT COUNT(*) as extreme_alt_count FROM gps_0_data WHERE Alt > 3000';
        const extremeAltResult = await processor.query(extremeAltQuery);
        console.log('Altitude values over 3000m count:', extremeAltResult);
        
        // Let's also check the raw data structure
        console.log('\n--- Raw Data Structure Check ---');
        if (testData.messages && testData.messages['GPS[0]']) {
            const gpsData = testData.messages['GPS[0]'];
            if (gpsData.Alt && typeof gpsData.Alt === 'object') {
                const altKeys = Object.keys(gpsData.Alt);
                console.log(`GPS Alt field has ${altKeys.length} values`);
                
                // Check first few altitude values
                const firstFewAlts = altKeys.slice(0, 5).map(k => gpsData.Alt[k]);
                console.log('First few altitude values from raw data:', firstFewAlts);
                
                // Check if there are any altitude values over 3000
                const highAlts = Object.values(gpsData.Alt).filter(alt => alt > 3000);
                console.log(`Altitude values over 3000m in raw data: ${highAlts.length}`);
                if (highAlts.length > 0) {
                    console.log('Sample high altitude values:', highAlts.slice(0, 5));
                }
            }
        }
        
        // Clean up
        await processor.close();
        console.log('\n✅ Query test completed!');
        
    } catch (error) {
        console.error('❌ Query test failed:', error);
        console.error(error.stack);
    }
}

queryRealData();
