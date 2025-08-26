<!-- eslint-disable -->
<template>
  <div class="backend-test">
    <h3>Backend Connection Test</h3>
    
    <div class="test-section">
      <h4>Health Check</h4>
      <button @click="testHealth" :disabled="healthLoading">
        {{ healthLoading ? 'Testing...' : 'Test Health Endpoint' }}
      </button>
      <div v-if="healthResult" class="result">
        <strong>Status:</strong> {{ healthResult.status }}<br>
        <strong>Message:</strong> {{ healthResult.message }}
      </div>
    </div>

    <div class="test-section">
      <h4>Chatbot Test</h4>
      <input v-model="chatMessage" placeholder="Enter a test message" />
      <button @click="testChatbot" :disabled="chatLoading">
        {{ chatLoading ? 'Sending...' : 'Send Message' }}
      </button>
      <div v-if="chatResult" class="result">
        <strong>Response:</strong> {{ chatResult.response }}<br>
        <strong>Timestamp:</strong> {{ chatResult.timestamp }}
      </div>
    </div>

    <div class="test-section">
      <h4>Stubbed Endpoints Test</h4>
      <button @click="testStubbedEndpoints" :disabled="stubbedLoading">
        {{ stubbedLoading ? 'Testing...' : 'Test Stubbed Endpoints' }}
      </button>
      <div v-if="stubbedResults.length > 0" class="result">
        <div v-for="(result, index) in stubbedResults" :key="index">
          <strong>{{ result.endpoint }}:</strong> {{ result.error }} - {{ result.message }}
        </div>
      </div>
    </div>

    <div v-if="error" class="error">
      <strong>Error:</strong> {{ error }}
    </div>
  </div>
</template>

<script>
export default {
    name: 'BackendTest',
    data () {
        return {
            healthLoading: false,
            chatLoading: false,
            stubbedLoading: false,
            healthResult: null,
            chatResult: null,
            stubbedResults: [],
            chatMessage: 'Hello, can you analyze my UAV log?',
            error: null
        }
    },
    methods: {
        async testHealth () {
            this.healthLoading = true
            this.error = null
            try {
                const response = await fetch('http://localhost:8001/health')
                const data = await response.json()
                this.healthResult = data
            } catch (err) {
                this.error = `Health check failed: ${err.message}`
            } finally {
                this.healthLoading = false
            }
        },

        async testChatbot () {
            this.chatLoading = true
            this.error = null
            try {
                const response = await fetch('http://localhost:8001/chatbot/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: this.chatMessage
                    })
                })
                const data = await response.json()
                this.chatResult = data
            } catch (err) {
                this.error = `Chatbot test failed: ${err.message}`
            } finally {
                this.chatLoading = false
            }
        },

        async testStubbedEndpoints () {
            this.stubbedLoading = true
            this.error = null
            this.stubbedResults = []

            const endpoints = ['/upload/test', '/eniro/test', '/uploaded/test']

            for (const endpoint of endpoints) {
                try {
                    const response = await fetch(`http://localhost:8001${endpoint}`, {
                        method: 'POST'
                    })
                    const data = await response.json()
                    this.stubbedResults.push(data)
                } catch (err) {
                    this.stubbedResults.push({
                        endpoint,
                        error: 'Connection Failed',
                        message: err.message
                    })
                }
            }

            this.stubbedLoading = false
        }
    }
}
</script>

<style scoped>
.backend-test {
  padding: 20px;
  max-width: 600px;
  margin: 0 auto;
}

.test-section {
  margin-bottom: 30px;
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.test-section h4 {
  margin-top: 0;
  color: #333;
}

button {
  background-color: #007bff;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 4px;
  cursor: pointer;
  margin: 10px 5px;
}

button:disabled {
  background-color: #6c757d;
  cursor: not-allowed;
}

button:hover:not(:disabled) {
  background-color: #0056b3;
}

input {
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  margin-right: 10px;
  width: 200px;
}

.result {
  margin-top: 15px;
  padding: 15px;
  background-color: #f8f9fa;
  border-radius: 4px;
  border-left: 4px solid #28a745;
}

.error {
  margin-top: 15px;
  padding: 15px;
  background-color: #f8d7da;
  border-radius: 4px;
  border-left: 4px solid #dc3545;
  color: #721c24;
}
</style>
