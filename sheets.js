// sheets.js

const { google } = require('googleapis');

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

// Helper to convert a 0-indexed column number to an A1-style letter (e.g., 0 -> A, 1 -> B)
function colToA1(colIndex) {
  let col = "";
  let temp;
  let letter = colIndex;
  while (letter >= 0) {
    temp = letter % 26;
    col = String.fromCharCode(temp + 65) + col;
    letter = Math.floor(letter / 26) - 1;
  }
  return col;
}

/**
 * NEW (REWRITTEN)
 * Creates a new sheet, adds creator info, and sets headers based on survey questions.
 * @param {string} sheetName - The desired name for the new sheet.
 * @param {string} creatorName - The Slack name of the user who created the survey.
 * @param {string[]} questionTexts - An array of the survey question strings.
 * @returns {boolean} - True if successful, false otherwise.
 */
async function createNewSheet(sheetName, creatorName, questionTexts) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        });

        const creatorRow = [['Survey Creator:', creatorName]];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: creatorRow },
        });

        const headers = [['User Name', 'Timestamp', ...questionTexts]];
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A2`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: headers },
        });

        console.log(`Successfully created new sheet: "${sheetName}"`);
        return true;
    } catch (error) {
        console.error(`Error creating new sheet:`, error.response ? error.response.data : error.message);
        return false;
    }
}

/**
 * NEW (REWRITTEN)
 * Saves or updates a user's response. Finds the user's row and the question's column,
 * then updates the specific cell. If the user is new, it appends a new row.
 * @param {object} responseData - The data to save.
 */
async function saveOrUpdateResponse({ sheetName, user, question, answer, timestamp }) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // 1. Get headers to find the question column
        const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!2:2`, // Headers are on row 2
        });
        const headers = headerRes.data.values ? headerRes.data.values[0] : [];
        const questionColIndex = headers.indexOf(question);
        if (questionColIndex === -1) {
            console.error(`Could not find question column for "${question}" in sheet "${sheetName}"`);
            return;
        }

        // 2. Get user column to find the user's row
        const userColRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A3:A`, // User data starts at row 3
        });
        const userColumn = userColRes.data.values ? userColRes.data.values.flat() : [];
        const userRowIndex = userColumn.indexOf(user); // 0-indexed position in the A3:A range

        if (userRowIndex !== -1) {
            // 3a. User exists, update their row
            const sheetRow = userRowIndex + 3; // +3 to convert to actual sheet row number (1-based, starts at A3)
            const questionColLetter = colToA1(questionColIndex);
            
            // Update the answer cell
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!${questionColLetter}${sheetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[answer]] },
            });
            // Update the timestamp in column B
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!B${sheetRow}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[timestamp]] },
            });

        } else {
            // 3b. New user, append a new row
            const numQuestions = headers.length - 2; // Subtract 'User Name' and 'Timestamp'
            const newRow = Array(numQuestions).fill('');
            newRow[questionColIndex - 2] = answer; // -2 to adjust for User/Timestamp cols

            await sheets.spreadsheets.values.append({
                spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[user, timestamp, ...newRow]] },
            });
        }
        console.log(`Successfully saved/updated response for "${user}" in sheet "${sheetName}"`);
    } catch (error) {
        console.error('Error saving to Google Sheet:', error.response ? error.response.data : error.message);
    }
}


/**
 * NEW (REWRITTEN)
 * Checks if a user has already answered a specific question by checking if the
 * corresponding cell in their row is filled.
 * @param {object} checkData - The data to check.
 */
async function checkIfAnswered({ sheetName, user, question }) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        const headerRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!2:2`,
        });
        const headers = headerRes.data.values ? headerRes.data.values[0] : [];
        const questionColIndex = headers.indexOf(question);
        if (questionColIndex === -1) return false;

        const userColRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A3:A`,
        });
        const userColumn = userColRes.data.values ? userColRes.data.values.flat() : [];
        const userRowIndex = userColumn.indexOf(user);

        if (userRowIndex === -1) return false; // User hasn't answered anything yet

        const sheetRow = userRowIndex + 3;
        const questionColLetter = colToA1(questionColIndex);

        const cellRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!${questionColLetter}${sheetRow}`,
        });

        // If the cell has any value, they have answered.
        const hasValue = cellRes.data.values && cellRes.data.values.length > 0 && cellRes.data.values[0][0] !== '';
        if (hasValue) {
            console.log(`Duplicate answer detected for user "${user}" on question "${question}" in sheet "${sheetName}"`);
            return true;
        }

        return false;
    } catch (error) {
        // If the sheet or range doesn't exist yet, it's not an error in this context
        if (error.code === 400) return false;
        console.error('Error checking for duplicates:', error.response ? error.response.data : error.message);
        return false;
    }
}


module.exports = {
  createNewSheet,
  saveOrUpdateResponse, // MODIFIED function name
  checkIfAnswered,
};
