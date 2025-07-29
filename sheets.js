// sheets.js

const { google } = require('googleapis');

// Check if the required environment variables are set.
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  throw new Error('The GOOGLE_CREDENTIALS_JSON environment variable is not set.');
}
if (!process.env.GOOGLE_SHEET_ID) {
    throw new Error('The GOOGLE_SHEET_ID environment variable is not set.');
}

// Parse the credentials from the environment variable.
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

// Configure the authentication client using the parsed credentials.
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: 'https://www.googleapis.com/auth/spreadsheets',
});

// The ID of your Google Sheet from the environment variables.
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

/**
 * Appends a new response row to the Google Sheet.
 * @param {object} responseData - The data to save.
 * @param {string} responseData.user - The name of the user.
 * @param {string} responseData.question - The text of the question.
 * @param {string} responseData.answer - The user's answer.
 * @param {string} responseData.timestamp - The ISO string of when the response occurred.
 */
async function saveResponseToSheet({ user, question, answer, timestamp }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // The data to be appended, formatted as a row.
    const row = [[user, question, answer, timestamp]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: 'Sheet1!A1', // Appends to the first empty row of the sheet named 'Sheet1'.
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
 * @param {object} checkData - The data to check for duplicates.
 * @param {string} checkData.user - The name of the user.
 * @param {string} checkData.question - The text of the question.
 * @returns {Promise<boolean>} - True if a duplicate answer exists, false otherwise.
 */
async function checkIfAnswered({ user, question }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // Read the 'User Name' (Column A) and 'Question' (Column B) columns.
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'Sheet1!A:B',
    });

    const rows = response.data.values;
    if (rows) {
      // Find a row where both the user's name and the question text match exactly.
      const found = rows.some(row => row[0] === user && row[1] === question);
      
      if (found) {
        console.log(`Duplicate answer detected for user "${user}" on question "${question}"`);
        return true; // A duplicate was found.
      }
    }
    
    // No duplicate was found.
    return false;

  } catch (error) {
    console.error('Error reading from Google Sheet to check for duplicates:', error);
    // If we can't check the sheet due to an error, fail safely by allowing the answer.
    // This prevents a sheet error from blocking all new survey responses.
    return false;
  }
}

// Export both functions so they can be used by app.js
module.exports = {
  saveResponseToSheet,
  checkIfAnswered,
};
