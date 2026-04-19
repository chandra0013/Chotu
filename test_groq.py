import requests
import json

# REPLACE THIS WITH YOUR REAL KEY
api_key = "PASTE_YOUR_GSK_KEY_HERE"
url = "https://api.groq.com/openai/v1/chat/completions"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

data = {
    "model": "llama-3.1-8b-instant",
    "messages": [
        {"role": "user", "content": "Return the word 'CONNECTED' and nothing else."}
    ],
    "max_tokens": 10
}

print("--- DIAGNOSTIC START ---")
print(f"Target URL: {url}")

try:
    print("Sending request to Groq...")
    response = requests.post(url, headers=headers, json=data, timeout=10)
    
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        content = result['choices'][0]['message']['content']
        print(f"RESPONSE SUCCESS: {content}")
    else:
        print(f"RESPONSE ERROR: {response.text}")

except Exception as e:
    print(f"CONNECTION FAILED: {str(e)}")

print("--- DIAGNOSTIC END ---")
