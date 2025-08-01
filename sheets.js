const { google } = require('googleapis');

if (process.env.NODE_ENV !== 'production') { require('dotenv').config(); }

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const USER_GROUPS_SHEET_NAME = 'UserGroups';
const TEMPLATES_SHEET_NAME = 'SurveyTemplates';

const authorize = () => {
    const credentials = JSON.parse(process.env.GOOGLE_SHEET_CREDENTIALS);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
};
const getSheetsClient = async () => google.sheets({ version: 'v4', auth: await authorize() });

const METADATA_ROWS = { 
    CREATOR: 1, 
    RECIPIENTS: 2, 
    REMINDER_MSG: 3, 
    REMINDER_HOURS: 4, 
    LAST_REMINDER: 5,
    DEFINITION: 6,
    HEADERS: 7
};

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

const getSurveyDefinition = async (sheetName) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!B${METADATA_ROWS.DEFINITION}` });
    if (!res.data.values || !res.data.values[0] || !res.data.values[0][0]) {
        throw new Error(`Survey definition not found for sheet: ${sheetName}`);
    }
    return JSON.parse(res.data.values[0][0]);
};

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

const getQuestionTextByIndex = async (sheetName, qIndex) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
    return res.data.values[0][qIndex + 2];
};

const ensureSheetExists = async (sheets, sheetName, headers) => { /* ... unchanged ... */ };
const saveSurveyTemplate = async ({ templateName, creatorId, surveyData }) => { /* ... unchanged ... */ };
const getAllSurveyTemplates = async () => { /* ... unchanged ... */ };
const getTemplateByName = async (templateName) => { /* ... unchanged ... */ };
const deleteSurveyTemplate = async (templateName) => { /* ... unchanged ... */ };
const getAllScheduledSurveys = async () => { /* ... unchanged ... */ };
const getIncompleteUsers = async (sheetName, recipients) => { /* ... unchanged ... */ };
const updateLastReminderTimestamp = async (sheetName, timestamp) => { /* ... unchanged ... */ };
const saveUserGroup = async ({ groupName, creatorId, memberIds }) => { /* ... */ };
const getAllUserGroups = async () => { /* ... */ };
const getGroupMembers = async (groupName) => { /* ... */ };

module.exports = {
    createNewSheetWithDetails, saveRecipients, getSurveyDefinition, saveOrUpdateResponse,
    checkIfAnswered, getQuestionTextByIndex, saveUserGroup, getAllUserGroups,
    getGroupMembers, saveSurveyTemplate, getAllSurveyTemplates, getTemplateByName,
    deleteSurveyTemplate, getAllScheduledSurveys, getIncompleteUsers,
    updateLastReminderTimestamp
};
