const DuckDBService = require('./src/services/duckdbService');
const LogDataProcessor = require('./src/services/logDataProcessor');

async function checkSchema() {
    try {
        console.log('🔍 Checking XKF4 table schema...');
        
        // Initialize DuckDB service
        const duckdbService = new DuckDBService();
        await duckdbService.initialize();
        
        // Initialize log data processor
        const logDataProcessor = new LogDataProcessor(duckdbService);
        await logDataProcessor.initialize();
        
        // Load test data
        const testData = require('./test_data.json');
        
        // Process the data
        await logDataProcessor.processLogData(testData);
        
        // Get schema for XKF4 tables
        const schema = await logDataProcessor.getDataSchema();
        
        // Extract XKF4 tables from the schema object
        const xkf4Tables = Object.entries(schema)
            .filter(([key, value]) => key.includes('XKF4'))
            .map(([key, value]) => ({ key, ...value }));
        
        console.log('\n📋 XKF4 Table Schema:');
        xkf4Tables.forEach(table => {
            console.log(`\n${table.key} (${table.tableName}):`);
            if (table.fields && Array.isArray(table.fields)) {
                const fieldNames = table.fields.map(f => f.name).join(', ');
                console.log(`  Fields: ${fieldNames}`);
            } else {
                console.log(`  Fields: No fields available`);
            }
        });
        
        // Check if there are any temperature-related fields
        const allFields = xkf4Tables.flatMap(t => 
            t.fields && Array.isArray(t.fields) ? t.fields.map(f => f.name) : []
        );
        
        console.log('\n🔍 All available fields in XKF4 tables:');
        allFields.forEach(field => console.log(`  - ${field}`));
        
        const tempFields = allFields.filter(f => 
            f.toLowerCase().includes('temp') || 
            f.toLowerCase().includes('batt') ||
            f.toLowerCase().includes('battery')
        );
        
        console.log('\n🌡️ Temperature/Battery related fields found:');
        if (tempFields.length > 0) {
            tempFields.forEach(field => console.log(`  - ${field}`));
        } else {
            console.log('  ❌ No temperature or battery fields found');
        }
        
        console.log('\n✅ Schema check completed!');
        
    } catch (error) {
        console.error('❌ Schema check failed:', error);
    }
}

checkSchema();
