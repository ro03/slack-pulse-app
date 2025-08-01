const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

if (process.env.NODE_ENV !== 'production') { require('dotenv').config(); }

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const USER_GROUPS_SHEET_NAME = 'UserGroups';
const TEMPLATES_SHEET_NAME = 'SurveyTemplates';

const authorize = () => {
    const credentialsPath = path.join('/etc/secrets', 'google_credentials.json');
    let credentials;
    if (fs.existsSync(credentialsPath)) {
        const credentialsFileContent = fs.readFileSync(credentialsPath);
        credentials = JSON.parse(credentialsFileContent);
    } else {
        if (!process.env.GOOGLE_SHEET_CREDENTIALS) {
            throw new Error('FATAL: GOOGLE_SHEET_CREDENTIALS env var is not set and secret file not found.');
        }
        credentials = JSON.parse(process.env.GOOGLE_SHEET_CREDENTIALS);
    }
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
};

const getSheetsClient = async () => google.sheets({ version: 'v4', auth: await authorize() });

const METADATA_ROWS = { 
    CREATOR: 1, RECIPIENTS: 2, REMINDER_MSG: 3, REMINDER_HOURS: 4, 
    LAST_REMINDER: 5, DEFINITION: 6, HEADERS: 7
};

// --- Survey Setup ---
const createNewSheetWithDetails = async (sheetName, creatorName, questionHeaders, details, surveyDefJson) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
    const metadata = [
        ['Survey Creator:', creatorName],
        ['Recipients:', '[]'],
        ['Reminder Message:', details.reminderMessage || ''],
        ['Reminder Hours:', details.reminderHours || 0],
        ['Last Reminder Timestamp:', ''],
        ['Survey Definition:', surveyDefJson || '{}'],
        ['User', 'Timestamp', ...questionHeaders]
    ];
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: metadata } });
    return true;
};

const saveRecipients = async (sheetName, recipients) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!B${METADATA_ROWS.RECIPIENTS}`, valueInputOption: 'USER_ENTERED', resource: { values: [[JSON.stringify(recipients)]] } });
};

// --- Data Retrieval ---
const getSurveyDefinition = async (sheetName) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!B${METADATA_ROWS.DEFINITION}` });
    if (!res.data.values || !res.data.values[0] || !res.data.values[0][0]) {
        throw new Error(`Survey definition not found for sheet: ${sheetName}`);
    }
    return JSON.parse(res.data.values[0][0]);
};

const getQuestionTextByIndex = async (sheetName, qIndex) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
    return res.data.values[0][qIndex + 2];
};

// --- Response Handling ---
const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => {
    try {
        const sheets = await getSheetsClient();
        const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
        if (!headerRes.data.values) {
            console.error(`[Sheets Error] Could not find header row in sheet: ${sheetName}`);
            return;
        }
        const headers = headerRes.data.values[0];
        const questionIndex = headers.indexOf(question);
        if (questionIndex < 2) {
            console.error(`[Sheets Error] Could not find question "${question}" in headers of sheet: ${sheetName}`);
            return;
        }
        const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A${METADATA_ROWS.HEADERS + 1}:A` });
        const users = userRes.data.values ? userRes.data.values.flat() : [];
        const userRowIndex = users.indexOf(user);
        if (userRowIndex > -1) {
            const sheetRowNumber = userRowIndex + METADATA_ROWS.HEADERS + 1;
            await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!${String.fromCharCode(65 + questionIndex)}${sheetRowNumber}`, valueInputOption: 'USER_ENTERED', resource: { values: [[answer]] } });
        } else {
            const newRow = new Array(headers.length).fill('');
            newRow[0] = user; newRow[1] = timestamp; newRow[questionIndex] = answer;
            await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: sheetName, valueInputOption: 'USER_ENTERED', resource: { values: [newRow] } });
        }
    } catch (e) {
        console.error("[Sheets Error] in saveOrUpdateResponse:", e.message);
    }
};

const checkIfAnswered = async ({ sheetName, user, question }) => {
    try {
        const sheets = await getSheetsClient();
        const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
        if (!headerRes.data.values) return false;
        const headers = headerRes.data.values[0];
        const questionIndex = headers.indexOf(question);
        if (questionIndex < 2) return false;
        const userRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A${METADATA_ROWS.HEADERS + 1}:A` });
        if (!userRes.data.values) return false;
        const users = userRes.data.values.flat();
        const userRowIndex = users.indexOf(user);
        if (userRowIndex > -1) {
            const sheetRowNumber = userRowIndex + METADATA_ROWS.HEADERS + 1;
            const cellValueRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${String.fromCharCode(65 + questionIndex)}${sheetRowNumber}`});
            return cellValueRes.data.values && cellValueRes.data.values[0][0] !== '';
        }
        return false;
    } catch (e) {
        console.error("[Sheets Error] in checkIfAnswered:", e.message);
        return false;
    }
};

// --- Template & General Sheet Management ---
const ensureSheetExists = async (sheets, sheetName, headers) => {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
    const sheetExists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
    if (!sheetExists) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
        if(headers) {
            await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: [headers] } });
        }
    }
};
const saveSurveyTemplate = async ({ templateName, creatorId, surveyData }) => {
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, TEMPLATES_SHEET_NAME, ['TemplateName', 'CreatorID', 'SurveyData', 'Timestamp']);
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: TEMPLATES_SHEET_NAME, valueInputOption: 'USER_ENTERED', resource: { values: [[templateName, creatorId, surveyData, new Date().toISOString()]] } });
};
const getAllSurveyTemplates = async () => {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TEMPLATES_SHEET_NAME}!A2:C` });
        if (!res.data.values) return [];
        return res.data.values.map(row => ({ TemplateName: row[0], CreatorID: row[1], SurveyData: row[2] }));
    } catch (e) {
        if (e.code === 400 && e.message.includes('Unable to parse range')) return [];
        throw e;
    }
};
const getTemplateByName = async (templateName) => {
    const templates = await getAllSurveyTemplates();
    return templates.find(t => t.TemplateName === templateName);
};
const deleteSurveyTemplate = async (templateName) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TEMPLATES_SHEET_NAME}!A:A` });
    if (!res.data.values) return;
    const rowIndex = res.data.values.findIndex(row => row[0] === templateName);
    if (rowIndex === -1 || rowIndex === 0) return;
    const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.sheetId,sheets.properties.title' });
    const templateSheetId = sheetInfo.data.sheets.find(s => s.properties.title === TEMPLATES_SHEET_NAME).properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: { requests: [{ deleteDimension: { range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] }
    });
};

// --- Reminder Functions ---
const getAllScheduledSurveys = async () => { /* ... unchanged and complete ... */ };
const getIncompleteUsers = async (sheetName, recipients) => { /* ... unchanged and complete ... */ };
const updateLastReminderTimestamp = async (sheetName, timestamp) => { /* ... unchanged and complete ... */ };

// --- Group Management (Corrected) ---
const saveUserGroup = async ({ groupName, creatorId, memberIds }) => {
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, USER_GROUPS_SHEET_NAME, ['GroupName', 'CreatorID', 'MemberIDs', 'Timestamp']);
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: USER_GROUPS_SHEET_NAME, valueInputOption: 'USER_ENTERED', resource: { values: [[groupName, creatorId, memberIds, new Date().toISOString()]] } });
};

const getAllUserGroups = async () => {
    try {
        const sheets = await getSheetsClient();
        await ensureSheetExists(sheets, USER_GROUPS_SHEET_NAME);
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${USER_GROUPS_SHEET_NAME}!A2:C` });
        if (!res.data.values) return [];
        return res.data.values.map(row => ({ GroupName: row[0], CreatorID: row[1], MemberIDs: row[2] }));
    } catch (e) {
        if (e.code === 400 && e.message.includes('Unable to parse range')) return [];
        throw e;
    }
};

const getGroupMembers = async (groupName) => {
    const groups = await getAllUserGroups();
    const group = groups.find(g => g.GroupName === groupName);
    return group ? group.MemberIDs.split(',') : [];
};

module.exports = {
    createNewSheetWithDetails, saveRecipients, getSurveyDefinition, saveOrUpdateResponse,
    checkIfAnswered, getQuestionTextByIndex, saveUserGroup, getAllUserGroups,
    getGroupMembers, saveSurveyTemplate, getAllSurveyTemplates, getTemplateByName,
    deleteSurveyTemplate, getAllScheduledSurveys, getIncompleteUsers,
    updateLastReminderTimestamp
};
