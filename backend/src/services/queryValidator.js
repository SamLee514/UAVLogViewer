const LogDataProcessor = require('./logDataProcessor');

class QueryValidator {
    constructor(logDataProcessor) {
        this.processor = logDataProcessor;
        this.queryLog = [];
    }

    /**
     * Extract SQL queries from LLM response text
     * @param {string} llmResponse - The LLM's response text
     * @returns {Array} Array of extracted SQL queries
     */
    extractSQLQueries(llmResponse) {
        const sqlPattern = /SELECT\s+.*?FROM\s+\w+(?:\s+WHERE\s+.*?)?(?:\s+ORDER\s+BY\s+.*?)?(?:\s+LIMIT\s+\d+)?/gi;
        const queries = [];
        let match;

        while ((match = sqlPattern.exec(llmResponse)) !== null) {
            queries.push({
                sql: match[0].trim(),
                index: match.index,
                fullMatch: match[0]
            });
        }

        return queries;
    }

    /**
     * Extract claimed results from LLM response
     * @param {string} llmResponse - The LLM's response text
     * @param {string} query - The SQL query to look for results for
     * @returns {Object} Extracted claimed results
     */
    extractClaimedResults(llmResponse, query) {
        // Look for patterns like "returns X", "shows X", "found X", etc.
        const resultPatterns = [
            /returns?\s+([\d.,]+)/i,
            /shows?\s+([\d.,]+)/i,
            /found\s+([\d.,]+)/i,
            /was\s+([\d.,]+)/i,
            /maximum\s+.*?was\s+([\d.,]+)/i,
            /minimum\s+.*?was\s+([\d.,]+)/i,
            /average\s+.*?was\s+([\d.,]+)/i,
            /returned\s+([\d.,]+)/i,
            /which\s+returned\s+([\d.,]+)/i,
            /result.*?([\d.,]+)/i
        ];

        const results = {};
        
        resultPatterns.forEach(pattern => {
            const match = llmResponse.match(pattern);
            if (match) {
                const value = parseFloat(match[1].replace(/,/g, ''));
                if (!isNaN(value)) {
                    results[pattern.source] = value;
                }
            }
        });

        // Also look for numbers that appear after the query
        const queryIndex = llmResponse.indexOf(query);
        if (queryIndex !== -1) {
            // Look for numbers in the text after the query
            const textAfterQuery = llmResponse.substring(queryIndex + query.length);
            const numberMatches = textAfterQuery.match(/(\d+(?:\.\d+)?)/g);
            if (numberMatches) {
                numberMatches.forEach(match => {
                    const value = parseFloat(match);
                    if (!isNaN(value) && value > 0) { // Only positive numbers for now
                        results[`after_query_${match}`] = value;
                    }
                });
            }
        }

        return results;
    }

    /**
     * Execute a SQL query and return results
     * @param {string} sql - SQL query to execute
     * @returns {Promise<Object>} Query execution result
     */
    async executeQuery(sql) {
        try {
            const startTime = Date.now();
            const result = await this.processor.query(sql);
            const executionTime = Date.now() - startTime;

            const queryInfo = {
                sql,
                result,
                executionTime,
                timestamp: new Date().toISOString(),
                success: true
            };

            this.queryLog.push(queryInfo);
            return queryInfo;

        } catch (error) {
            const queryInfo = {
                sql,
                error: error.message,
                timestamp: new Date().toISOString(),
                success: false
            };

            this.queryLog.push(queryInfo);
            throw error;
        }
    }

    /**
     * Validate LLM response by executing mentioned queries
     * @param {string} llmResponse - The LLM's response text
     * @returns {Promise<Object>} Validation results
     */
    async validateResponse(llmResponse) {
        const queries = this.extractSQLQueries(llmResponse);
        const validations = [];

        console.log(`🔍 Validating ${queries.length} SQL queries mentioned in LLM response...`);

        for (const queryInfo of queries) {
            try {
                const queryResult = await this.executeQuery(queryInfo.sql);
                const claimedResults = this.extractClaimedResults(llmResponse, queryInfo.sql);
                
                const validation = {
                    query: queryInfo.sql,
                    claimedResults,
                    actualResult: queryResult.result,
                    executionTime: queryResult.executionTime,
                    hasDiscrepancy: false,
                    discrepancies: []
                };

                // Check for discrepancies
                if (Object.keys(claimedResults).length > 0) {
                    validation.discrepancies = this.findDiscrepancies(claimedResults, queryResult.result);
                    validation.hasDiscrepancy = validation.discrepancies.length > 0;
                }

                validations.push(validation);

                if (validation.hasDiscrepancy) {
                    console.log(`🚨 Query discrepancy found:`, validation.discrepancies);
                }

            } catch (error) {
                validations.push({
                    query: queryInfo.sql,
                    error: error.message,
                    hasDiscrepancy: true,
                    discrepancies: [`Query execution failed: ${error.message}`]
                });
            }
        }

        return {
            totalQueries: queries.length,
            validQueries: validations.filter(v => !v.hasDiscrepancy).length,
            queriesWithDiscrepancies: validations.filter(v => v.hasDiscrepancy).length,
            validations,
            queryLog: this.queryLog
        };
    }

    /**
     * Find discrepancies between claimed and actual results
     * @param {Object} claimedResults - Results claimed by LLM
     * @param {Array} actualResult - Actual query result
     * @returns {Array} Array of discrepancy descriptions
     */
    findDiscrepancies(claimedResults, actualResult) {
        const discrepancies = [];

        // For now, let's focus on simple numeric results
        // This can be expanded to handle more complex result types
        if (actualResult && actualResult.length > 0) {
            const firstRow = actualResult[0];
            
            Object.keys(claimedResults).forEach(pattern => {
                const claimedValue = claimedResults[pattern];
                
                // Look for numeric values in the result
                Object.values(firstRow).forEach(actualValue => {
                    if (typeof actualValue === 'number' && !isNaN(actualValue)) {
                        const difference = Math.abs(claimedValue - actualValue);
                        const percentDifference = (difference / Math.abs(actualValue)) * 100;
                        
                        // Flag if difference is more than 5% or 10 units
                        if (percentDifference > 5 || difference > 10) {
                            discrepancies.push({
                                pattern,
                                claimed: claimedValue,
                                actual: actualValue,
                                difference,
                                percentDifference: percentDifference.toFixed(2)
                            });
                        }
                    }
                });
            });
        }

        return discrepancies;
    }

    /**
     * Generate corrective feedback for discrepancies
     * @param {Array} validations - Validation results
     * @returns {string} Corrective feedback text
     */
    generateCorrectiveFeedback(validations) {
        const feedbacks = [];

        validations.forEach(validation => {
            if (validation.hasDiscrepancy && validation.discrepancies.length > 0) {
                feedbacks.push(`\n🔍 Query: ${validation.query}`);
                validation.discrepancies.forEach(disc => {
                    feedbacks.push(`   ❌ Claimed: ${disc.claimed}, Actual: ${disc.actual} (${disc.percentDifference}% difference)`);
                });
            }
        });

        if (feedbacks.length > 0) {
            return `\n⚠️ CORRECTIVE FEEDBACK:\n${feedbacks.join('\n')}\n\nPlease correct your analysis using the actual query results above.`;
        }

        return '';
    }

    /**
     * Get query execution history
     * @returns {Array} Query execution log
     */
    getQueryHistory() {
        return this.queryLog;
    }

    /**
     * Clear query history
     */
    clearQueryHistory() {
        this.queryLog = [];
    }
}

module.exports = QueryValidator;
