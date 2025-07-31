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
const saveOrUpdateResponse = async ({ sheetName, user, question, answer, timestamp }) => { /* ... Unchanged ... */ };
const checkIfAnswered = async ({ sheetName, user, question }) => { /* ... Unchanged ... */ };
const getQuestionTextByIndex = async (sheetName, qIndex) => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!${METADATA_ROWS.HEADERS}:${METADATA_ROWS.HEADERS}` });
    return res.data.values[0][qIndex + 2];
};

// --- Template Management ---
const ensureSheetExists = async (sheets, sheetName, headers) => { /* ... Helper to create a sheet if it doesn't exist ... */ };
const saveSurveyTemplate = async ({ templateName, creatorId, surveyData }) => {
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, TEMPLATES_SHEET_NAME, ['TemplateName', 'CreatorID', 'SurveyData', 'Timestamp']);
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: `${TEMPLATES_SHEET_NAME}!A:A`, valueInputOption: 'USER_ENTERED', resource: { values: [[templateName, creatorId, surveyData, new Date().toISOString()]] } });
};
const getAllSurveyTemplates = async () => { /* ... Returns all rows from TEMPLATES_SHEET_NAME ... */ };
const getTemplateByName = async (templateName) => { /* ... Finds and returns a single template by name ... */ };
const deleteSurveyTemplate = async (templateName) => { /* ... Finds the row and uses batchUpdate with deleteDimension to remove it ... */ };

// --- Reminder Functions ---
const getAllScheduledSurveys = async () => {
    const sheets = await getSheetsClient();
    const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
    const allSheetTitles = res.data.sheets.map(s => s.properties.title).filter(t => t !== USER_GROUPS_SHEET_NAME && t !== TEMPLATES_SHEET_NAME);
    
    const scheduledSurveys = [];
    for (const title of allSheetTitles) {
        const metaRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!B1:B${METADATA_ROWS.LAST_REMINDER}` });
        const metaVals = metaRes.data.values || [];
        const reminderHours = parseInt(metaVals[METADATA_ROWS.REMINDER_HOURS -1]?.[0] || '0', 10);
        if (reminderHours > 0) {
            scheduledSurveys.push({
                sheetName: title,
                recipients: JSON.parse(metaVals[METADATA_ROWS.RECIPIENTS - 1]?.[0] || '[]'),
                reminderMessage: metaVals[METADATA_ROWS.REMINDER_MSG - 1]?.[0] || 'Reminder: Please complete the survey.',
                reminderHours,
                lastReminder: metaVals[METADATA_ROWS.LAST_REMINDER - 1]?.[0] || '0',
            });
        }
    }
    return scheduledSurveys;
};
const getIncompleteUsers = async (sheetName, headers, recipients) => { /* ... Returns an array of recipient objects {id, ts} for users with empty cells ... */ };
const updateLastReminderTimestamp = async (sheetName, timestamp) => { /* ... Updates cell B5 with the timestamp ... */ };

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
    deleteSurveyTemplate,
};
