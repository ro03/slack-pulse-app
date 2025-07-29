// sheets.js

const { google } = require('googleapis');

// Check if the environment variable for credentials exists
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  throw new Error('GOOGLE_CREDENTIALS_JSON environment variable not set.');
}

// Parse the credentials from the environment variable
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

// Configure the authentication client using the parsed credentials
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: 'https://www.googleapis.com/auth/spreadsheets',
});

// Your Google Sheet ID from the .env file
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

/**
 * Appends a new response to the Google Sheet.
 */
async function saveResponseToSheet({ user, question, answer, timestamp }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const row = [[user, question, answer, timestamp]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: row,
      },
    });
    console.log('Successfully saved response to Google Sheet.');
  } catch (error) {
    console.error('Error saving to Google Sheet:', error);
  }
}

/**
 * Checks if a user has already answered a specific question by reading the sheet.
 */
async function checkIfAnswered({ user, question }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Sheet1!A:B', // Assumes User is in Col A, Question in Col B
    });

    const rows = response.data.values;
    if (rows) {
      const found = rows.some(row => row[0] === user && row[1] === question);
      if (found) {
        console.log(`Duplicate answer detected for user "${user}" on question "${question}"`);
        return true;
      }
    }
    
    return false;

  } catch (error) {
    console.error('Error reading from Google Sheet to check for duplicates:', error);
    return false;
  }
}

module.exports = {
  saveResponseToSheet,
  checkIfAnswered,
};
