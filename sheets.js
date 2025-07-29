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
 * MODIFIED
 * Creates a new sheet, freezes the top rows, and adds metadata and headers.
 * @param {string} sheetName - The desired name for the new sheet.
 * @param {string} creatorName - The name of the user who created the survey.
 * @param {string[]} questionHeaders - An array of the questions for the header.
 * @returns {boolean} - True if successful, false otherwise.
 */
async function createNewSheet(sheetName, creatorName, questionHeaders) {
    try {
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        // Build the metadata and header rows
        const metadataRows = [
            ['Survey created by:', creatorName],
            ['Date Created:', new Date().toUTCString()],
            [], // Spacer row
            ['Questions in this survey:'],
            ...questionHeaders.map((q, i) => [`Q${i+1}: ${q}`])
        ];
        const spacerRowCount = 2; // Add space between metadata and data
        const dataHeaderRow = ['User Name', 'Question', 'Answer', 'Timestamp'];
        const headerRowCount = metadataRows.length + spacerRowCount + 1;

        // Batch request to create and format the sheet
        const requests = [
            { addSheet: { properties: { title: sheetName } } },
            { 
                updateSheetProperties: {
                    properties: { sheetId: null, title: sheetName, gridProperties: { frozenRowCount: headerRowCount } },
                    fields: 'gridProperties.frozenRowCount'
                }
            }
        ];

        const addSheetResponse = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests },
        });
        
        // Find the new sheet's ID to apply the frozen row update correctly
        const newSheetId = addSheetResponse.data.replies.find(r => r.addSheet).addSheet.properties.sheetId;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: [{ 
                updateSheetProperties: {
                    properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: headerRowCount } },
                    fields: 'gridProperties.frozenRowCount'
                }
            }]}
        });

        // Add metadata and headers to the new sheet
        const allHeaderData = [
            ...metadataRows,
            ...Array(spacerRowCount).fill([]), // Add empty spacer rows
            dataHeaderRow
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: allHeaderData },
        });

        console.log(`Successfully created new sheet: "${sheetName}"`);
        return true;
    } catch (error) {
        console.error(`Error creating new sheet:`, error.response ? error.response.data.error : error);
        return false;
    }
}


/**
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
      range: `${sheetName}!A1`,
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
 * Checks a specific sheet to see if a user has already answered a question.
 * @param {object} checkData - The data to check for duplicates.
 * @param {string} checkData.sheetName - The name of the sheet to check.
 */
async function checkIfAnswered({ sheetName, user, question }) {
  try {
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // We get the whole sheet, which might be inefficient for very large sheets,
    // but is necessary because the header size is now dynamic.
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A:B`, 
    });

    const rows = response.data.values;
    if (rows) {
      // Find the start of the actual data by looking for the 'User Name' header
      let dataStartIndex = rows.findIndex(row => row[0] === 'User Name');
      if (dataStartIndex === -1) {
          console.error("Could not find data header row in sheet:", sheetName);
          return false; // Or handle this error more gracefully
      }

      const dataRows = rows.slice(dataStartIndex + 1);
      const found = dataRows.some(row => row[0] === user && row[1] === question);
      
      if (found) {
        console.log(`Duplicate answer detected for user "${user}" on question "${question}" in sheet "${sheetName}"`);
        return true;
      }
    }
    
    return false;

  } catch (error) {
    // If sheet doesn't exist yet, it's not an error, just means no one has answered.
    if (error.code === 400 && error.errors[0].message.includes('Unable to parse range')) {
        return false;
    }
    console.error('Error reading from Google Sheet to check for duplicates:', error);
    return false; // Fail safe
  }
}


module.exports = {
  createNewSheet,
  saveResponseToSheet,
  checkIfAnswered,
};
