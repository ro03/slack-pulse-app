const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  keyFile: './googleServiceAccount.json', // Your downloaded JSON file
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

async function saveResponseToSheet({ user, question, answer, timestamp }) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const values = [[user, question, answer, timestamp]];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Responses!A1', // Your sheet name & start cell
      valueInputOption: 'RAW',
      requestBody: { values },
    });
    console.log('Response saved to Google Sheets');
  } catch (error) {
    console.error('Error saving to Sheets:', error);
  }
}

module.exports = { saveResponseToSheet };
