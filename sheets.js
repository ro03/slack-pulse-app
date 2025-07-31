const { google } = require('googleapis');

if (process.env.NODE_ENV !== 'production') { require('dotenv').config(); }

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const USER_GROUPS_SHEET_NAME = 'UserGroups';
const TEMPLATES_SHEET_NAME = 'SurveyTemplates';

const authorize = () => {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
};
const getSheetsClient = async () => google.sheets({ version: 'v4', auth: await authorize() });

const METADATA_ROWS = { RECIPIENTS: 2, REMINDER_MSG: 3, REMINDER_HOURS: 4, LAST_REMINDER: 5, HEADERS: 6 };

// --- Survey Setup ---
const createNewSheetWithDetails = async (sheetName, creatorName, questionHeaders, details) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
    const metadata = [
        ['Survey Creator:', creatorName],
        ['Recipients:', '[]'],
        ['Reminder Message:', details.reminderMessage || ''],
        ['Reminder Hours:', details.reminderHours || 0],
        ['Last Reminder Timestamp:', ''],
        ['User', 'Timestamp', ...questionHeaders]
    ];
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: metadata } });
    return true;
};

const saveRecipients = async (sheetName, recipients) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!B${METADATA_ROWS.RECIPIENTS}`, valueInputOption: 'USER_ENTERED', resource: { values: [[JSON.stringify(recipients)]] } });
};

// --- Response Handling ---
const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => { /* Fully implemented in previous answer */ };
const checkIfAnswered = async ({ sheetName, user, question }) => { /* Fully implemented in previous answer */ };
const getQuestionTextByIndex = async (sheetName, qIndex) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
    return res.data.values[0][qIndex + 2];
};

// --- Template Management ---
const ensureSheetExists = async (sheets, sheetName, headers) => {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
    const sheetExists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
    if (!sheetExists) {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
        await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!A1`, valueInputOption: 'USER_ENTERED', resource: { values: [headers] } });
    }
};

const saveSurveyTemplate = async ({ templateName, creatorId, surveyData }) => {
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, TEMPLATES_SHEET_NAME, ['TemplateName', 'CreatorID', 'SurveyData', 'Timestamp']);
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: TEMPLATES_SHEET_NAME,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[templateName, creatorId, surveyData, new Date().toISOString()]] }
    });
};

const getAllSurveyTemplates = async () => {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TEMPLATES_SHEET_NAME}!A2:C` });
        if (!res.data.values) return [];
        return res.data.values.map(row => ({ TemplateName: row[0], CreatorID: row[1], SurveyData: row[2] }));
    } catch (e) {
        if (e.code === 400) return []; // Sheet doesn't exist yet
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
    if (rowIndex === -1) return;
    
    const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.sheetId,sheets.properties.title' });
    const templateSheetId = sheetInfo.data.sheets.find(s => s.properties.title === TEMPLATES_SHEET_NAME).properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: { requests: [{ deleteDimension: { range: { sheetId: templateSheetId, dimension: 'ROWS', startIndex: rowIndex + 1, endIndex: rowIndex + 2 } } }] }
    });
};

// --- Reminder Functions ---
const getAllScheduledSurveys = async () => { /* Fully implemented in previous answer */ };
const getIncompleteUsers = async (sheetName, recipients) => { /* Fully implemented in previous answer */ };
const updateLastReminderTimestamp = async (sheetName, timestamp) => { /* Fully implemented in previous answer */ };

// --- Group Management (Unchanged) ---
const saveUserGroup = async ({ groupName, creatorId, memberIds }) => { /* ... */ };
const getAllUserGroups = async () => { /* ... */ };
const getGroupMembers = async (groupName) => { /* ... */ };

module.exports = { 
    createNewSheetWithDetails,
    saveRecipients,
    saveOrUpdateResponse,
    checkIfAnswered,
    getQuestionTextByIndex,
    saveUserGroup,
    getAllUserGroups,
    getGroupMembers,
    saveSurveyTemplate,
    getAllSurveyTemplates,
    getTemplateByName,
    deleteSurveyTemplate,};
