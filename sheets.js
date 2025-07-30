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

// --- Group Management Functions (Unchanged) ---
const saveUserGroup = async ({ groupName, creatorId, memberIds }) => { /* ... */ };
const getAllUserGroups = async () => { /* ... */ };
const getGroupMembers = async (groupName) => { /* ... */ };


// --- Survey Setup and Response Functions ---

const createNewSheet = async (sheetName, creatorName, questionHeaders) => {
 try {
   const sheets = await getSheetsClient();
   await sheets.spreadsheets.batchUpdate({
     spreadsheetId: SHEET_ID,
     resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
   });
   const values = [
       ['Survey Creator:', creatorName],
       ['User', 'Timestamp', ...questionHeaders]
   ];
   await sheets.spreadsheets.values.update({
     spreadsheetId: SHEET_ID,
     range: `${sheetName}!A1`,
     valueInputOption: 'USER_ENTERED',
     resource: { values },
   });
   return true;
 } catch (error) {
   console.error('Error creating new sheet:', error);
   return false;
 }
};

// 💡 RESTORED: This function saves or updates a single answer in the sheet.
const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => {
 try {
   const sheets = await getSheetsClient();
   const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!2:2` });
   const headers = headerRes.data.values[0];
   const questionIndex = headers.indexOf(question);
   if (questionIndex < 2) return; // Not found or protected column

   const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A3:A` });
   const users = userRes.data.values ? userRes.data.values.flat() : [];
   const userRowIndex = users.indexOf(user);

   if (userRowIndex > -1) { // User exists, update row
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
       range: `${sheetName}!A:A`,
       valueInputOption: 'USER_ENTERED',
       resource: { values: [newRow] },
     });
   }
 } catch (error) {
   console.error('Error saving or updating response:', error);
 }
};

// 💡 RESTORED: This function checks if a specific question has been answered by a user.
const checkIfAnswered = async ({ sheetName, user, question }) => {
 try {
   const sheets = await getSheetsClient();
   const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!2:2` });
   if (!headerRes.data.values) return false;
   const headers = headerRes.data.values[0];
   const questionIndex = headers.indexOf(question);
   if (questionIndex < 2) return false;

   const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A3:A` });
   if (!userRes.data.values) return false;
   const users = userRes.data.values.flat();
   const userRowIndex = users.indexOf(user);

   if (userRowIndex > -1) {
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

// 💡 RESTORED: Gets a single question text by its index.
async function getQuestionTextByIndex(sheetName, qIndex) {
    const sheets = await getSheetsClient();
    const headerRes = await sheets.spreadsheets.values.get({ 
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!2:2` 
    });
    const headers = headerRes.data.values[0];
    return headers[qIndex + 2];
}

module.exports = {
 createNewSheet,
 saveOrUpdateResponse,
 checkIfAnswered,
 saveUserGroup,
 getAllUserGroups,
 getGroupMembers,
 getQuestionTextByIndex,
};
