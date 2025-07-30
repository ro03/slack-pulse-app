const { google } = require('googleapis');

if (process.env.NODE_ENV !== 'production') {
 require('dotenv').config();
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const USER_GROUPS_SHEET_NAME = 'UserGroups';

const authorize = () => {
 const credentialsJson = process.env.GOOGLE_SHEETS_CREDENTIALS;
 if (!credentialsJson) {
   throw new Error('FATAL: GOOGLE_SHEETS_CREDENTIALS environment variable is not set.');
 }
 const credentials = JSON.parse(credentialsJson);
 const auth = new google.auth.GoogleAuth({
   credentials,
   scopes: ['https://www.googleapis.com/auth/spreadsheets'],
 });
 return auth.getClient();
};

const getSheetsClient = async () => {
 const authClient = await authorize();
 return google.sheets({ version: 'v4', auth: authClient });
};

// ... (Unchanged group management functions: saveUserGroup, getAllUserGroups, getGroupMembers) ...

// 💡 CHANGE: Add creator name to the sheet and adjust header row
const createNewSheet = async (sheetName, creatorName, questionHeaders) => {
 try {
   const sheets = await getSheetsClient();
   await sheets.spreadsheets.batchUpdate({
     spreadsheetId: SHEET_ID,
     resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
   });

   // Write creator info to row 1 and headers to row 2
   const values = [
       ['Survey Creator:', creatorName],
       ['User', 'Timestamp', ...questionHeaders]
   ];

   await sheets.spreadsheets.values.update({
     spreadsheetId: SHEET_ID,
     range: `${sheetName}!A1`, // Start writing at A1
     valueInputOption: 'USER_ENTERED',
     resource: { values },
   });

   return true;
 } catch (error) {
   console.error('Error creating new sheet:', error);
   return false;
 }
};

// 💡 CHANGE: Adjust row indexing to account for new header structure
const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => {
 try {
   const sheets = await getSheetsClient();
   // Headers are now on row 2
   const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!2:2` });
   const headers = headerRes.data.values[0];
   const questionIndex = headers.indexOf(question);
   if (questionIndex < 2) return; // Not found or protected column

   // User data starts from row 3
   const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A3:A` });
   const users = userRes.data.values ? userRes.data.values.flat() : [];
   const userRowIndex = users.indexOf(user); // This is a 0-based index of the *data* rows

   if (userRowIndex > -1) { // User exists, update row
     // The actual sheet row is the data index + 3 (for 2 header rows and 1-based indexing)
     const sheetRowNumber = userRowIndex + 3;
     await sheets.spreadsheets.values.update({
       spreadsheetId: SHEET_ID,
       range: `${sheetName}!${String.fromCharCode(65 + questionIndex)}${sheetRowNumber}`,
       valueInputOption: 'USER_ENTERED',
       resource: { values: [[answer]] },
     });
   } else { // New user, append row
     const newRow = new Array(headers.length).fill('');
     newRow[0] = user;
     newRow[1] = timestamp;
     newRow[questionIndex] = answer;
     await sheets.spreadsheets.values.append({
       spreadsheetId: SHEET_ID,
       range: `${sheetName}!A:A`, // Append will find the next empty row automatically
       valueInputOption: 'USER_ENTERED',
       resource: { values: [newRow] },
     });
   }
 } catch (error) {
   console.error('Error saving or updating response:', error);
 }
};

// 💡 CHANGE: Adjust row indexing to account for new header structure
const checkIfAnswered = async ({ sheetName, user, question }) => {
 try {
   const sheets = await getSheetsClient();
   // Headers are now on row 2
   const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!2:2` });
   if (!headerRes.data.values) return false;
   const headers = headerRes.data.values[0];
   const questionIndex = headers.indexOf(question);
   if (questionIndex < 2) return false;

   // User data starts from row 3
   const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A3:A` });
   if (!userRes.data.values) return false;
   const users = userRes.data.values.flat();
   const userRowIndex = users.indexOf(user);

   if (userRowIndex > -1) {
     // Actual sheet row is data index + 3
     const sheetRowNumber = userRowIndex + 3;
     const cellValueRes = await sheets.spreadsheets.values.get({
       spreadsheetId: SHEET_ID,
       range: `${sheetName}!${String.fromCharCode(65 + questionIndex)}${sheetRowNumber}`,
     });
     return cellValueRes.data.values && cellValueRes.data.values[0][0] !== '';
   }
   return false;
 } catch (error) {
   console.error('Error checking if answered:', error);
   return false;
 }
};

// This function is called from the main index.js file
// 💡 CHANGE: Adjust header row to read from row 2
async function getQuestionTextByIndex(sheetName, qIndex) {
    const sheets = await getSheetsClient();
    const headerRes = await sheets.spreadsheets.values.get({ 
        spreadsheetId: SHEET_ID,
        // The data headers are on the second row
        range: `${sheetName}!2:2` 
    });
    const headers = headerRes.data.values[0];
    // Column C is index 2. qIndex starts at 0. So question 1 (qIndex 0) is at headers[0+2].
    return headers[qIndex + 2];
}

module.exports = {
 createNewSheet,
 saveOrUpdateResponse,
 checkIfAnswered,
 saveUserGroup,
 getAllUserGroups,
 getGroupMembers,
 getQuestionTextByIndex, // Make sure to export this if it's not already
};
