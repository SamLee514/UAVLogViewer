const duckdb = require('duckdb');

class DuckDBService {
    constructor() {
        this.db = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.db = new duckdb.Database(':memory:');
            this.isInitialized = true;
            console.log('✅ DuckDB service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize DuckDB service:', error);
            throw error;
        }
    }

    /**
     * Infer table schema from message data
     * @param {string} messageType - The message type (e.g., 'ATT', 'GPS[0]')
     * @param {Object} messageData - The message data object
     * @returns {Object} Schema information
     */
    inferTableSchema(messageType, messageData) {
        const fields = Object.keys(messageData);
        const timeField = fields.find(f => f === 'time_boot_ms');
        
        // Check if this is a time-series message or a static message
        if (timeField) {
            // Time-series message (e.g., ATT, GPS)
            const dataFields = fields.filter(f => f !== 'time_boot_ms');
            const timeKeys = Object.keys(messageData.time_boot_ms);
            
            // Infer data types from first few values
            const schema = dataFields.map(field => {
                const sampleValue = messageData[field][timeKeys[0]];
                // DuckDB handles JS numbers as REAL, so we'll use that for all numeric data
                const type = typeof sampleValue === 'number' ? 'REAL' : 'TEXT';
                
                return {
                    name: field,
                    type: type
                };
            });

            return {
                messageType,
                timeKeys,
                dataFields,
                schema,
                recordCount: timeKeys.length,
                isTimeSeries: true
            };
                } else {
            // Static message (e.g., FILE, PARM) - treat as single record
            const schema = fields.map(field => {
                const sampleValue = messageData[field];
                const type = typeof sampleValue === 'number' ? 'REAL' : 'TEXT';
                
                return {
                    name: field,
                    type: type
                };
            });

            return {
                messageType,
                timeKeys: [],
                dataFields: fields,
                schema,
                recordCount: 1,
                isTimeSeries: false
            };
        }
    }

    /**
     * Transform indexed message data to arrays, handling sparse data
     * @param {Object} messageData - The message data object
     * @param {Object} schema - The inferred schema
     * @returns {Object} Transformed data with arrays
     */
    transformToArrays(messageData, schema) {
        if (schema.isTimeSeries) {
            // Time-series message
            const result = {
                time_boot_ms: schema.timeKeys.map(k => messageData.time_boot_ms[k])
            };

            schema.dataFields.forEach(field => {
                result[field] = schema.timeKeys.map(timeKey => {
                    // Handle sparse data - use NULL if field doesn't have data for this timestamp
                    return messageData[field][timeKey] !== undefined ? messageData[field][timeKey] : null;
                });
            });

            return result;
        } else {
            // Static message - create single row
            const result = {};
            schema.dataFields.forEach(field => {
                result[field] = [messageData[field]];
            });
            return result;
        }
    }

    /**
     * Validate and clean data arrays to ensure consistent lengths
     * @param {Object} transformedData - The transformed data arrays
     * @returns {Object} Cleaned data with consistent lengths
     */
    validateAndCleanData(transformedData) {
        const result = {};
        const lengths = [];
        
        // Get all array lengths
        Object.keys(transformedData).forEach(field => {
            if (Array.isArray(transformedData[field])) {
                lengths.push(transformedData[field].length);
            }
        });
        
        if (lengths.length === 0) return transformedData;
        
        // Find the most common length (likely the correct one)
        const lengthCounts = {};
        lengths.forEach(len => {
            lengthCounts[len] = (lengthCounts[len] || 0) + 1;
        });
        
        const targetLength = Object.keys(lengthCounts).reduce((a, b) => 
            lengthCounts[a] > lengthCounts[b] ? a : b
        );
        
        console.log(`    🔧 Data validation: target length ${targetLength}, found lengths:`, lengthCounts);
        
        // Truncate all arrays to the target length
        Object.keys(transformedData).forEach(field => {
            if (Array.isArray(transformedData[field])) {
                result[field] = transformedData[field].slice(0, targetLength);
            } else {
                result[field] = transformedData[field];
            }
        });
        
        return result;
    }

    /**
     * Fix schema mismatch by adjusting field count to match actual data
     * @param {Object} schema - The inferred schema
     * @param {Object} cleanedData - The cleaned data arrays
     * @returns {Object} Adjusted schema
     */
    fixSchemaMismatch(schema, cleanedData) {
        if (!schema.isTimeSeries) return schema;
        
        // Count actual fields in cleaned data
        const actualFieldCount = Object.keys(cleanedData).length;
        const expectedFieldCount = schema.dataFields.length + 1; // +1 for time_boot_ms
        
        if (actualFieldCount !== expectedFieldCount) {
            console.log(`    🔧 Schema mismatch: expected ${expectedFieldCount} fields, got ${actualFieldCount}`);
            
            // Adjust schema to match actual data
            const actualFields = Object.keys(cleanedData).filter(f => f !== 'time_boot_ms');
            const adjustedSchema = actualFields.map(field => {
                const sampleValue = cleanedData[field][0];
                const type = typeof sampleValue === 'number' ? 'REAL' : 'TEXT';
                
                return {
                    name: field,
                    type: type
                };
            });
            
            return {
                ...schema,
                dataFields: actualFields,
                schema: adjustedSchema
            };
        }
        
        return schema;
    }

    /**
     * Create DuckDB table for a message type
     * @param {string} messageType - The message type
     * @param {Object} schema - The inferred schema
     * @param {Object} transformedData - The transformed data arrays
     */
    async createTable(messageType, schema, transformedData) {
        try {
            const tableName = this.getTableName(messageType);
            
            // Drop table if it exists
            console.log(`  🗑️ Dropping table ${tableName} if exists...`);
            await this.exec(`DROP TABLE IF EXISTS ${tableName}`);
            
            // Create table with schema
            let createSQL;
            if (schema.isTimeSeries) {
                const columns = schema.schema.map(f => `${this.escapeFieldName(f.name)} ${f.type}`).join(', ');
                createSQL = `CREATE TABLE ${tableName} (time_boot_ms REAL, ${columns})`;
            } else {
                const columns = schema.schema.map(f => `${this.escapeFieldName(f.name)} ${f.type}`).join(', ');
                createSQL = `CREATE TABLE ${tableName} (${columns})`;
            }
            
            console.log(`  📋 Creating table with SQL: ${createSQL}`);
            await this.exec(createSQL);
            
            // Create index on time_boot_ms for fast time-based queries (only for time-series)
            if (schema.isTimeSeries) {
                console.log(`  📊 Creating index on time_boot_ms...`);
                await this.exec(`CREATE INDEX idx_${tableName}_time ON ${tableName} (time_boot_ms)`);
            }
            
            // Insert data
            console.log(`  💾 Inserting data...`);
            await this.insertData(tableName, schema, transformedData);
            
            const recordCount = schema.isTimeSeries ? transformedData.time_boot_ms.length : 1;
            console.log(`✅ Created table ${tableName} with ${recordCount} records`);
            
            return tableName;
        } catch (error) {
            console.error(`❌ Failed to create table for ${messageType}:`, error);
            throw error;
        }
    }

    /**
     * Insert data into DuckDB table
     * @param {string} tableName - The table name
     * @param {Object} schema - The schema information
     * @param {Object} transformedData - The transformed data arrays
     */
    async insertData(tableName, schema, transformedData) {
        try {
            if (schema.isTimeSeries) {
                // Time-series data
                const { timeKeys, dataFields } = schema;
                const { time_boot_ms } = transformedData;
                
                console.log(`    📝 Preparing time-series insert for ${timeKeys.length} rows...`);
                
                // Prepare insert statement
                const columns = ['time_boot_ms', ...dataFields.map(f => this.escapeFieldName(f))];
                const placeholders = columns.map(() => '?').join(', ');
                const insertSQL = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
                
                console.log(`    📝 Insert SQL: ${insertSQL}`);
                
                // Prepare data for bulk insert
                const rows = [];
                for (let i = 0; i < timeKeys.length; i++) {
                    const row = [time_boot_ms[i]];
                    dataFields.forEach(field => {
                        row.push(transformedData[field][i]);
                    });
                    rows.push(row);
                }
                
                console.log(`    📝 Prepared ${rows.length} rows for insert`);
                console.log(`    📝 Sample row: ${JSON.stringify(rows[0])}`);
                
                // Execute bulk insert using VALUES syntax
                console.log(`    📝 Executing bulk insert using VALUES...`);
                const valuesList = rows.map(row => `(${row.map(val => typeof val === 'string' ? `'${val}'` : val).join(', ')})`).join(', ');
                const bulkInsertSQL = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${valuesList}`;
                
                console.log(`    📝 Bulk insert SQL: ${bulkInsertSQL.substring(0, 100)}...`);
                await this.exec(bulkInsertSQL);
                console.log(`    ✅ Bulk insert completed`);
            } else {
                // Static data
                const { dataFields } = schema;
                
                console.log(`    📝 Preparing static data insert...`);
                
                // Prepare insert statement
                const columns = dataFields.map(f => this.escapeFieldName(f));
                const placeholders = columns.map(() => '?').join(', ');
                const insertSQL = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
                
                console.log(`    📝 Insert SQL: ${insertSQL}`);
                
                // Prepare data for single row insert
                const row = dataFields.map(field => transformedData[field][0]);
                
                console.log(`    📝 Row data: ${JSON.stringify(row)}`);
                
                // Execute insert
                console.log(`    📝 Executing insert...`);
                await this.exec(insertSQL, [row]);
                console.log(`    ✅ Insert completed`);
            }
            
        } catch (error) {
            console.error(`❌ Failed to insert data into ${tableName}:`, error);
            throw error;
        }
    }

    /**
     * Get standardized table name for a message type
     * @param {string} messageType - The message type
     * @returns {string} The table name
     */
    getTableName(messageType) {
        // Handle array notation like GPS[0] -> gps_0_data
        return messageType.toLowerCase()
            .replace(/\[/g, '_')
            .replace(/\]/g, '')
            .replace(/[^a-z0-9_]/g, '_') + '_data';
    }

    /**
     * Escape field names that are SQL keywords
     * @param {string} fieldName - The field name to escape
     * @returns {string} The escaped field name
     */
    escapeFieldName(fieldName) {
        // List of common SQL keywords that might appear in field names
        const sqlKeywords = [
            'offset', 'order', 'group', 'where', 'select', 'from', 'table',
            'index', 'key', 'primary', 'foreign', 'unique', 'check', 'default',
            'constraint', 'references', 'cascade', 'restrict', 'null', 'not',
            'and', 'or', 'in', 'between', 'like', 'is', 'as', 'by', 'having',
            'union', 'all', 'distinct', 'top', 'limit', 'offset', 'fetch'
        ];
        
        const lowerFieldName = fieldName.toLowerCase();
        if (sqlKeywords.includes(lowerFieldName)) {
            return `"${fieldName}"`;
        }
        return fieldName;
    }

    /**
     * Execute SQL query
     * @param {string} sql - SQL query string
     * @param {Array} params - Optional parameters for prepared statements
     * @returns {Promise} Query result
     */
    async exec(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (params.length > 0 && Array.isArray(params[0])) {
                // Bulk insert - execute each row separately
                console.log(`    📝 Executing bulk insert with ${params.length} rows...`);
                let completed = 0;
                let hasError = false;
                
                params.forEach((row, index) => {
                    this.db.exec(sql, row, (err, result) => {
                        if (err && !hasError) {
                            hasError = true;
                            reject(err);
                            return;
                        }
                        
                        completed++;
                        if (completed === params.length && !hasError) {
                            resolve(result);
                        }
                    });
                });
            } else if (params.length > 0) {
                // Single row insert
                this.db.exec(sql, params, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            } else {
                // No parameters
                this.db.exec(sql, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            }
        });
    }

    /**
     * Query data from tables
     * @param {string} sql - SQL query string
     * @returns {Promise} Query result
     */
    async query(sql) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    /**
     * Get list of available tables
     * @returns {Promise<Array>} List of table names
     */
    async getTables() {
        try {
            const result = await this.query("SELECT name FROM sqlite_master WHERE type='table'");
            return result.map(row => row.name);
        } catch (error) {
            console.error('❌ Failed to get tables:', error);
            return [];
        }
    }

    /**
     * Get table schema information
     * @param {string} tableName - The table name
     * @returns {Promise<Array>} Table schema information
     */
    async getTableSchema(tableName) {
        try {
            const result = await this.query(`PRAGMA table_info(${tableName})`);
            return result;
        } catch (error) {
            console.error(`❌ Failed to get schema for ${tableName}:`, error);
            return [];
        }
    }

    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.isInitialized = false;
        }
    }
}

module.exports = DuckDBService;
