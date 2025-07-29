// sheets.js

const { google } = require('googleapis');

// Check if the required environment variables are set.
if (!process.env.GOOGLE_CREDENTIALS_JSON) {
  throw new Error('The GOOGLE_CREDENTIALS_JSON environment variable is not set.');
}
if (!process.env.GOOGLE_SHEET_ID) {
    throw new Error('The GOOGLE_SHEET_ID environment variable is not set.');
}

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: 'https://www.googleapis.com/auth/spreadsheets',
});
const spreadsheetId = process.env.GOOGLE_SHEET_ID;

/**
 * NEW FUNCTION
 * Creates a new sheet (tab) in the spreadsheet and adds headers.
 * @param {string} sheetName - The desired name for the new sheet.
 * @returns {boolean} - True if successful, false otherwise.
 */
async function createNewSheet(sheetName) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Request to create a new sheet
        const addSheetRequest = {
            requests: [
                {
                    addSheet: {
                        properties: {
                            title: sheetName,
                        },
                    },
                },
            ],
        };

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: addSheetRequest,
        });

        // Add headers to the new sheet
        const headers = [['User Name', 'Question', 'Answer', 'Timestamp']];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`, // Start at cell A1 of the new sheet
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: headers,
            },
        });

        console.log(`Successfully created new sheet: "${sheetName}"`);
        return true;
    } catch (error) {
        console.error(`Error creating new sheet:`, error);
        return false;
    }
}

/**
 * MODIFIED
 * Appends a new response row to a specific sheet.
 * @param {object} responseData - The data to save.
 * @param {string} responseData.sheetName - The name of the sheet to write to.
 */
async function saveResponseToSheet({ sheetName, user, question, answer, timestamp }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const row = [[user, question, answer, timestamp]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A1`, // MODIFIED: Appends to the specified sheet
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: row,
      },
    });
    console.log(`Successfully saved response to sheet: "${sheetName}"`);
  } catch (error) {
    console.error('Error saving to Google Sheet:', error);
  }
}

/**
 * MODIFIED
 * Checks a specific sheet to see if a user has already answered a question.
 * @param {object} checkData - The data to check for duplicates.
 * @param {string} checkData.sheetName - The name of the sheet to check.
 */
async function checkIfAnswered({ sheetName, user, question }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A:B`, // MODIFIED: Reads from the specified sheet
    });

    const rows = response.data.values;
    if (rows) {
      const found = rows.some(row => row[0] === user && row[1] === question);
      
      if (found) {
        console.log(`Duplicate answer detected for user "${user}" on question "${question}" in sheet "${sheetName}"`);
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
  createNewSheet, // NEW
  saveResponseToSheet,
  checkIfAnswered,
};
