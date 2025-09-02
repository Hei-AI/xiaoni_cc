const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testToken() {
  const token = 'AIzaSyAXHRNSvnqSkj_CuJyKsxS31UIjBuFrc0E';
  const genAI = new GoogleGenerativeAI(token);
  
  try {
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp'
    });
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }]
    });
    
    const response = await result.response;
    const text = response.text();
    
    console.log('Success:', text);
  } catch (error) {
    console.log('Error:', error.message);
    console.log('Stack:', error.stack);
  }
}

testToken();