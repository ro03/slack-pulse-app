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
        if (!process.env.GOOGLE_SHEETS_CREDENTIALS) {
            throw new Error('FATAL: GOOGLE_SHEETS_CREDENTIALS env var is not set and secret file not found.');
        }
        credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    }
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }).getClient();
};

const getSheetsClient = async () => google.sheets({ version: 'v4', auth: await authorize() });

const METADATA_ROWS = {
    CREATOR: 1,
    CREATOR_ID: 2, // New row
    RECIPIENTS: 3,
    REMINDER_MSG: 4,
    REMINDER_HOURS: 5,
    LAST_REMINDER: 6,
    DEFINITION: 7,
    HEADERS: 8 // Adjust all subsequent rows
};

const createNewSheetWithDetails = async (sheetName, creatorName, creatorId, questionHeaders, details, surveyDefJson) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, resource: { requests: [{ addSheet: { properties: { title: sheetName } } }] } });
    const metadata = [
        ['Survey Creator:', creatorName],
        ['Creator ID:', creatorId], // Add creator ID here
        ['Recipients:', '[]'],
        ['Reminder Message:', details.reminderMessage || ''],
        ['Reminder Hours:', details.reminderHours || 0],
        ['Last Reminder Timestamp:', ''],
        ['Survey Definition:', surveyDefJson || '{}'],
        ['User', 'Timestamp', ...questionHeaders]
    ];
    // Adjust the range to account for the new row
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

const getAllScheduledSurveys = async () => {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
        const allSheetTitles = res.data.sheets.map(s => s.properties.title).filter(t => t !== USER_GROUPS_SHEET_NAME && t !== TEMPLATES_SHEET_NAME);
        const scheduledSurveys = [];
        for (const title of allSheetTitles) {
            try {
                const metaRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!B1:B${METADATA_ROWS.LAST_REMINDER}` });
                const metaVals = metaRes.data.values || [];
                const reminderHours = parseInt(metaVals[METADATA_ROWS.REMINDER_HOURS - 1]?.[0] || '0', 10);
                if (reminderHours > 0) {
                    scheduledSurveys.push({
                        sheetName: title,
                        recipients: JSON.parse(metaVals[METADATA_ROWS.RECIPIENTS - 1]?.[0] || '[]'),
                        reminderMessage: metaVals[METADATA_ROWS.REMINDER_MSG - 1]?.[0] || '',
                        reminderHours,
                        lastReminder: metaVals[METADATA_ROWS.LAST_REMINDER - 1]?.[0] || '0',
                    });
                }
            } catch (e) { /* ignore sheets that don't match format */ }
        }
        return scheduledSurveys;
    } catch (e) {
        console.error("[Sheets Error] in getAllScheduledSurveys:", e.message);
        return [];
    }
};

const getIncompleteUsers = async (sheetName, recipients) => {
    const sheets = await getSheetsClient();
    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A${METADATA_ROWS.HEADERS}:Z` });
    if (!dataRes.data.values) return recipients.filter(r => r.id.startsWith('U'));
    const headers = dataRes.data.values[0];
    const questionCount = headers.length - 2;
    const userData = dataRes.data.values.slice(1);
    const userNamesInSheet = userData.map(row => row[0]);
    const incompleteRecipients = recipients.filter(recipient => {
        if (!recipient.id.startsWith('U')) return false;
        const userSheetIndex = userNamesInSheet.findIndex(name => name === recipient.name);
        if (userSheetIndex === -1) return true;
        const userRow = userData[userSheetIndex];
        let answeredCount = 0;
        for (let i = 2; i < headers.length; i++) {
            if (userRow[i]) answeredCount++;
        }
        return answeredCount < questionCount;
    });
    return incompleteRecipients;
};

const updateLastReminderTimestamp = async (sheetName, timestamp) => {
    const sheets = await getSheetsClient();
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${sheetName}!B${METADATA_ROWS.LAST_REMINDER}`, valueInputOption: 'USER_ENTERED', resource: { values: [[timestamp]] } });
};

const saveUserGroup = async ({ groupName, creatorId, memberIds }) => {
    const sheets = await getSheetsClient();
    await ensureSheetExists(sheets, USER_GROUPS_SHEET_NAME, ['GroupName', 'CreatorID', 'MemberIDs', 'Timestamp']);
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: USER_GROUPS_SHEET_NAME, valueInputOption: 'USER_ENTERED', resource: { values: [[groupName, creatorId, memberIds, new Date().toISOString()]] } });
};

const getAllUserGroups = async () => {
    try {
        const sheets = await getSheetsClient();
        await ensureSheetExists(sheets, USER_GROUPS_SHEET_NAME, ['GroupName', 'CreatorID', 'MemberIDs', 'Timestamp']);
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


const getSurveysByCreator = async (creatorId) => {
    try {
        const sheets = await getSheetsClient();
        const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' });
        const allSheetTitles = res.data.sheets.map(s => s.properties.title).filter(t => t !== USER_GROUPS_SHEET_NAME && t !== TEMPLATES_SHEET_NAME);

        const creatorSurveys = [];
        for (const title of allSheetTitles) {
            try {
                const metaRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${title}!B${METADATA_ROWS.CREATOR_ID}` });
                const storedCreatorId = metaRes.data.values?.[0]?.[0];
                if (storedCreatorId === creatorId) {
                    creatorSurveys.push(title);
                }
            } catch (e) { /* Ignore sheets that don't match the format */ }
        }
        return creatorSurveys;
    } catch (e) {
        console.error("[Sheets Error] in getSurveysByCreator:", e.message);
        return [];
    }
};

const getSurveyResults = async (sheetName) => {
    try {
        const sheets = await getSheetsClient();
        // Fetch headers and all data rows
        const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A${METADATA_ROWS.HEADERS}:Z` });
        if (!dataRes.data.values || dataRes.data.values.length < 2) {
            return { headers: [], responses: [] }; // No responses yet
        }
        const headers = dataRes.data.values[0];
        const responses = dataRes.data.values.slice(1).map(row => {
            let responseObj = {};
            headers.forEach((header, index) => {
                responseObj[header] = row[index] || '';
            });
            return responseObj;
        });
        return { headers, responses };
    } catch (e) {
        console.error(`[Sheets Error] in getSurveyResults for ${sheetName}:`, e.message);
        return null;
    }
};

module.exports = {
    createNewSheetWithDetails, saveRecipients, getSurveyDefinition, saveOrUpdateResponse,
    checkIfAnswered, getQuestionTextByIndex, saveUserGroup, getAllUserGroups,
    getGroupMembers, saveSurveyTemplate, getAllSurveyTemplates, getTemplateByName,
    deleteSurveyTemplate, getAllScheduledSurveys, getIncompleteUsers,
    updateLastReminderTimestamp, getSurveysByCreator,
    getSurveyResults
};
