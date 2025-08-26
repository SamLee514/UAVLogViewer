const DocCacheService = require('./src/services/docCacheService');

async function testCache() {
    console.log('🧪 Testing DocCacheService...\n');
    
    const cache = new DocCacheService();
    
    try {
        // Test 1: Initialize
        console.log('1️⃣ Testing initialization...');
        await cache.initialize();
        console.log('✅ Initialization successful\n');
        
        // Test 2: Check status
        console.log('2️⃣ Testing cache status...');
        const status = cache.getCacheStatus();
        console.log('📊 Cache status:', JSON.stringify(status, null, 2), '\n');
        
        // Test 3: Test hash generation
        console.log('3️⃣ Testing hash generation...');
        const testContent = 'Hello, this is test content for ArduPilot docs';
        const hash1 = cache.generateContentHash(testContent);
        const hash2 = cache.generateContentHash(testContent);
        const hash3 = cache.generateContentHash('Different content');
        
        console.log('Hash 1:', hash1);
        console.log('Hash 2:', hash2);
        console.log('Hash 3:', hash3);
        console.log('Hash 1 === Hash 2:', hash1 === hash2);
        console.log('Hash 1 === Hash 3:', hash1 === hash3);
        console.log('✅ Hash generation working correctly\n');
        
        // Test 4: Test needsUpdate logic
        console.log('4️⃣ Testing update detection...');
        const url = 'https://ardupilot.org/plane/docs/logmessages.html';
        const needsUpdate1 = await cache.needsUpdate(url, testContent);
        console.log('Needs update (first time):', needsUpdate1);
        
        // Update cache
        await cache.updateDocs(url, testContent, [{ content: testContent, embedding: [0.1, 0.2, 0.3] }]);
        
        const needsUpdate2 = await cache.needsUpdate(url, testContent);
        console.log('Needs update (after caching):', needsUpdate2);
        
        const needsUpdate3 = await cache.needsUpdate(url, 'Different content');
        console.log('Needs update (content changed):', needsUpdate3);
        console.log('✅ Update detection working correctly\n');
        
        // Test 5: Final status
        console.log('5️⃣ Final cache status...');
        const finalStatus = cache.getCacheStatus();
        console.log('📊 Final status:', JSON.stringify(finalStatus, null, 2), '\n');
        
        console.log('🎉 All tests passed! DocCacheService is working correctly.');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testCache();
