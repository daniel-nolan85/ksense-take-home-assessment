# Patient Risk Assessment

This project fetches patient data from a remote API, calculates risk scores based on blood pressure, temperature, and age, and submits the assessment results back to the API.

## How It Works

- Fetches patient data in pages, with retry logic for intermittent errors.
- Calculates risk scores for each patient.
- Tracks patients who are high risk, have fever, or data quality issues.
- Submits the compiled assessment results to the API.

## Requirements

- Node.js (v14 or higher recommended)
- An `.env` file in the root directory with your API key: API_KEY=your_api_key_here

## How to Run

1. Clone the repository  
2. Install dependencies: npm install
3. Create a .env file in the project root with your API key.
4. Run the script: npm start
