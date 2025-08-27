const DuckDBService = require('./duckdbService');

class LogDataProcessor {
    constructor() {
        this.duckdbService = new DuckDBService();
        this.isInitialized = false;
        this.processedTables = new Map(); // messageType -> tableName
    }

    async initialize() {
        try {
            await this.duckdbService.initialize();
            this.isInitialized = true;
            console.log('✅ Log data processor initialized');
        } catch (error) {
            console.error('❌ Failed to initialize log data processor:', error);
            throw error;
        }
    }

    /**
     * Process log data and load into DuckDB tables
     * @param {Object} logData - The log data object from frontend
     * @returns {Promise<Object>} Processing results
     */
    async processLogData(logData) {
        if (!this.isInitialized) {
            throw new Error('Log data processor not initialized');
        }

        try {
            console.log('🔄 Processing log data...');
            
            const { messages } = logData;
            if (!messages || typeof messages !== 'object') {
                throw new Error('Invalid log data: messages object not found');
            }

            const messageTypes = Object.keys(messages);
            console.log(`📊 Found ${messageTypes.length} message types:`, messageTypes);

            const results = {
                totalMessageTypes: messageTypes.length,
                processedTables: [],
                errors: [],
                summary: {}
            };

            // Process each message type
            for (const messageType of messageTypes) {
                try {
                    // Skip problematic message types
                    if (messageType === 'FILE') {
                        console.log(`⏭️ Skipping ${messageType} - file content not needed for analysis`);
                        continue;
                    }
                    if (messageType === 'FNCE') {
                        console.log(`⏭️ Skipping ${messageType} - no fields for analysis`);
                        continue;
                    }
                    if (messageType === 'PARM') {
                        console.log(`⏭️ Skipping ${messageType} - inconsistent row lengths`);
                        continue;
                    }
                    if (messageType === 'POS') {
                        console.log(`⏭️ Skipping ${messageType} - schema mismatch`);
                        continue;
                    }
                    
                    const result = await this.processMessageType(messageType, messages[messageType]);
                    results.processedTables.push(result);
                    results.summary[messageType] = {
                        tableName: result.tableName,
                        recordCount: result.recordCount,
                        fields: result.fields
                    };
                } catch (error) {
                    console.error(`❌ Failed to process ${messageType}:`, error);
                    results.errors.push({
                        messageType,
                        error: error.message
                    });
                }
            }

            console.log(`✅ Processed ${results.processedTables.length} message types`);
            return results;

        } catch (error) {
            console.error('❌ Failed to process log data:', error);
            throw error;
        }
    }

    /**
     * Process a single message type
     * @param {string} messageType - The message type
     * @param {Object} messageData - The message data
     * @returns {Promise<Object>} Processing result
     */
    async processMessageType(messageType, messageData) {
        try {
            console.log(`🔄 Processing ${messageType}...`);

            // Infer schema from data
            const schema = this.duckdbService.inferTableSchema(messageType, messageData);
            console.log(`  📋 Schema: ${schema.dataFields.length} fields, ${schema.recordCount} records`);

            // Transform data to arrays
            const transformedData = this.duckdbService.transformToArrays(
                messageData, 
                schema
            );

            // Validate and clean data to ensure consistent lengths
            const cleanedData = this.duckdbService.validateAndCleanData(transformedData);

            // Fix schema mismatch if needed
            const adjustedSchema = this.duckdbService.fixSchemaMismatch(schema, cleanedData);

            // Create DuckDB table
            const tableName = await this.duckdbService.createTable(messageType, adjustedSchema, cleanedData);
            
            // Store mapping for later use
            this.processedTables.set(messageType, tableName);

            return {
                messageType,
                tableName,
                recordCount: schema.recordCount,
                fields: schema.dataFields,
                schema: schema.schema
            };

        } catch (error) {
            console.error(`❌ Failed to process message type ${messageType}:`, error);
            throw error;
        }
    }

    /**
     * Get available tables for querying
     * @returns {Promise<Array>} List of available tables
     */
    async getAvailableTables() {
        try {
            const tables = await this.duckdbService.getTables();
            return tables.map(tableName => ({
                tableName,
                messageType: this.getMessageTypeFromTable(tableName)
            }));
        } catch (error) {
            console.error('❌ Failed to get available tables:', error);
            return [];
        }
    }

    /**
     * Get message type from table name
     * @param {string} tableName - The table name
     * @returns {string} The message type
     */
    getMessageTypeFromTable(tableName) {
        // Reverse the table naming convention
        const baseName = tableName.replace('_data', '');
        // This is a simplified reverse - in practice we might want to store this mapping
        return baseName.toUpperCase();
    }

    /**
     * Execute SQL query on the processed data
     * @param {string} sql - SQL query string
     * @returns {Promise<Array>} Query results
     */
    async query(sql) {
        if (!this.isInitialized) {
            throw new Error('Log data processor not initialized');
        }
        return await this.duckdbService.query(sql);
    }

    /**
     * Get data schema information
     * @returns {Promise<Object>} Schema information for all tables
     */
    async getDataSchema() {
        try {
            const tables = await this.getAvailableTables();
            const schema = {};

            for (const table of tables) {
                const tableSchema = await this.duckdbService.getTableSchema(table.tableName);
                schema[table.messageType] = {
                    tableName: table.tableName,
                    fields: tableSchema.map(col => ({
                        name: col.name,
                        type: col.type,
                        notNull: col.notnull === 1,
                        defaultValue: col.dflt_value
                    }))
                };
            }

            return schema;
        } catch (error) {
            console.error('❌ Failed to get data schema:', error);
            return {};
        }
    }

    /**
     * Get sample data from a table
     * @param {string} tableName - The table name
     * @param {number} limit - Number of rows to return
     * @returns {Promise<Array>} Sample data
     */
    async getSampleData(tableName, limit = 5) {
        try {
            const sql = `SELECT * FROM ${tableName} ORDER BY time_boot_ms LIMIT ${limit}`;
            return await this.query(sql);
        } catch (error) {
            console.error(`❌ Failed to get sample data from ${tableName}:`, error);
            return [];
        }
    }

    /**
     * Close the processor and clean up resources
     */
    async close() {
        if (this.duckdbService) {
            this.duckdbService.close();
        }
        this.isInitialized = false;
    }
}

module.exports = LogDataProcessor;
