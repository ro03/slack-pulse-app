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

// --- Group Management Functions (FIX: Re-added) ---

const saveUserGroup = async ({ groupName, creatorId, memberIds }) => {
 try {
   const sheets = await getSheetsClient();
   await sheets.spreadsheets.values.append({
     spreadsheetId: SHEET_ID,
     range: `${USER_GROUPS_SHEET_NAME}!A:C`,
     valueInputOption: 'USER_ENTERED',
     resource: {
       values: [[groupName, creatorId, memberIds]],
     },
   });
   return true;
 } catch (error) {
   console.error('Error saving user group to sheet:', error);
   return false;
 }
};

const getAllUserGroups = async () => {
   try {
       const sheets = await getSheetsClient();
       const res = await sheets.spreadsheets.values.get({
           spreadsheetId: SHEET_ID,
           range: `${USER_GROUPS_SHEET_NAME}!A2:C`, // A2 to skip header
       });

       const rows = res.data.values || [];
       const groups = rows.map(row => ({ GroupName: row[0], CreatorID: row[1], MemberIDs: row[2] }));
       return groups;
   } catch (error) {
       console.error('Error fetching all user groups:', error);
       return [];
   }
};

const getGroupMembers = async (groupName) => {
 try {
   const allGroups = await getAllUserGroups();
   const group = allGroups.find(g => g.GroupName === groupName);
   return group ? group.MemberIDs.split(',') : [];
 } catch (error) {
   console.error(`Error fetching members for group ${groupName}:`, error);
   return [];
 }
};


// --- Survey Response Functions ---

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

const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => {
 try {
   const sheets = await getSheetsClient();
   const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!2:2` });
   const headers = headerRes.data.values[0];
   const questionIndex = headers.indexOf(question);
   if (questionIndex < 2) return;

   const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A3:A` });
   const users = userRes.data.values ? userRes.data.values.flat() : [];
   const userRowIndex = users.indexOf(user);

   if (userRowIndex > -1) {
     const sheetRowNumber = userRowIndex + 3;
     await sheets.spreadsheets.values.update({
       spreadsheetId: SHEET_ID,
       range: `${sheetName}!${String.fromCharCode(65 + questionIndex)}${sheetRowNumber}`,
       valueInputOption: 'USER_ENTERED',
       resource: { values: [[answer]] },
     });
   } else {
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

async function getQuestionTextByIndex(sheetName, qIndex) {
    const sheets = await getSheetsClient();
    const headerRes = await sheets.spreadsheets.values.get({ 
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!2:2` 
    });
    const headers = headerRes.data.values[0];
    return headers[qIndex + 2];
}

// FIX: All exported functions are now defined in this file.
module.exports = {
 createNewSheet,
 saveOrUpdateResponse,
 checkIfAnswered,
 saveUserGroup,
 getAllUserGroups,
 getGroupMembers,
 getQuestionTextByIndex,
};
