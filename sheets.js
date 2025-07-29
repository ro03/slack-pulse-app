const { google } = require('googleapis');

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const USER_GROUPS_SHEET_NAME = 'UserGroups';

// Helper function to get an authenticated Google Sheets client
const authorize = () => {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
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

// Helper function to convert a zero-based column index to A1 notation (e.g., 0 -> A, 26 -> AA)
const columnIndexToA1 = (index) => {
    let result = '';
    let temp = index;
    while (temp >= 0) {
        result = String.fromCharCode((temp % 26) + 65) + result;
        temp = Math.floor(temp / 26) - 1;
    }
    return result;
};


// --- Group Management Functions ---

const saveUserGroup = async ({ groupName, creatorId, memberIds }) => {
    try {
        const sheets = await getSheetsClient();
        // Check if group already exists, if so, update. For now, we just append.
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
            range: `${USER_GROUPS_SHEET_NAME}!A2:C`,
        });

        const rows = res.data.values || [];
        const groups = rows.map(row => ({ GroupName: row[0], CreatorID: row[1], MemberIDs: row[2] })).filter(g => g.GroupName); // Filter out empty rows
        return groups;
    } catch (error) {
        console.error('CRITICAL ERROR in getAllUserGroups:', error);
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
        const headers = [['User', 'Timestamp', ...questionHeaders]];
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: headers },
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
        const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!1:1` });
        const headers = headerRes.data.values[0];
        const questionIndex = headers.indexOf(question);
        if (questionIndex < 2) return; // Not found or protected column

        const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:A` });
        const users = userRes.data.values ? userRes.data.values.flat() : [];
        let userRowIndex = users.indexOf(user);

        // If the user has responded to a checkbox question, their row might exist but be empty for other questions.
        // We handle this by checking if userRowIndex is -1. If it is, append. If not, update.
        if (userRowIndex > -1) {
            const columnLetter = columnIndexToA1(questionIndex); // <-- CORRECTED
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${sheetName}!${columnLetter}${userRowIndex + 1}`, // <-- CORRECTED
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[answer]] },
            });
            // Update timestamp if it's a new answer
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${sheetName}!B${userRowIndex + 1}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[timestamp]] },
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
                insertDataOption: 'INSERT_ROWS',
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
        const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!1:1` });
        if (!headerRes.data.values) return false;
        const headers = headerRes.data.values[0];
        const questionIndex = headers.indexOf(question);
        if (questionIndex < 2) return false;

        const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:A` });
        if (!userRes.data.values) return false;
        const users = userRes.data.values.flat();
        const userRowIndex = users.indexOf(user);

        if (userRowIndex > -1) {
            const columnLetter = columnIndexToA1(questionIndex); // <-- CORRECTED
            const cellValueRes = await sheets.spreadsheets.values.get({
                spreadsheetId: SHEET_ID,
                range: `${sheetName}!${columnLetter}${userRowIndex + 1}`, // <-- CORRECTED
            });
            return cellValueRes.data.values && cellValueRes.data.values.length > 0 && cellValueRes.data.values[0][0] !== '';
        }
        return false;
    } catch (error) {
        console.error('Error checking if answered:', error);
        return false;
    }
};


module.exports = {
    createNewSheet,
    saveOrUpdateResponse,
    checkIfAnswered,
    saveUserGroup,
    getAllUserGroups,
    getGroupMembers,
};
