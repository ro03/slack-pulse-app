const { App, ExpressReceiver } = require('@slack/bolt');
const {
    createNewSheetWithDetails,
    saveRecipients,
    saveOrUpdateResponse,
    checkIfAnswered,
    getQuestionTextByIndex,
    getSurveyDefinition,
    saveUserGroup,
    getAllUserGroups,
    getGroupMembers,
    saveSurveyTemplate,
    getAllSurveyTemplates,
    getTemplateByName,
    deleteSurveyTemplate,
} = require('./sheets');
const { startScheduler } = require('./scheduler');

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// --- App Initialization ---
const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver: receiver });

// --- Basic Express Routes ---
receiver.app.get('/', (req, res) => { res.status(200).send('App is up and running!'); });
receiver.app.get('/api/slack/callback', async (req, res) => {
    try {
        await app.client.oauth.v2.access({ client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET, code: req.query.code, });
        res.send('Your app has been successfully installed! You can close this window.');
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('Something went wrong during installation.');
    }
});

// --- Helper: Build Interactive elements for a question ---
const buildQuestionActions = (questionData, sheetName, questionIndex) => {
    const { options, pollFormat } = questionData;
    const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
    const valuePayload = (label) => JSON.stringify({ sheetName, label, qIndex: questionIndex });
    let elements = [];
    let questionOptions = options;

    switch (pollFormat) {
        case 'multiple-choice':
            elements.push({ type: 'button', text: { type: 'plain_text', text: '📝 Select Options' }, action_id: 'multiple_choice_modal_button', value: JSON.stringify({ sheetName, qIndex: questionIndex }) });
            break;
        case 'open-ended':
            elements.push({ type: 'button', text: { type: 'plain_text', text: '✍️ Answer Question' }, action_id: 'open_ended_answer_modal', value: JSON.stringify({ sheetName, qIndex: questionIndex }) });
            break;
        case 'dropdown':
            elements.push({ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: questionOptions.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) });
            break;
        case '1-to-5':
            questionOptions = ['1', '2', '3', '4', '5'];
            elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
            break;
        case '1-to-10':
            questionOptions = Array.from({ length: 10 }, (_, i) => (i + 1).toString());
            elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
            break;
        case 'agree-disagree':
            questionOptions = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];
            elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
            break;
        case 'nps':
             questionOptions = Array.from({ length: 11 }, (_, i) => i.toString());
             elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
             break;
        case 'buttons':
        default:
            elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
            break;
    }
    return { type: 'actions', block_id: `actions_for_q_${questionIndex}`, elements: elements };
};

// --- Helper: Generate Survey Modal Blocks ---
const generateModalBlocks = (viewData = {}) => {
    const { questions = [], userGroups = [], templates = [] } = viewData;
    let blocks = [];
    const questionTypeOptions = [ { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Multiple Choice' }, value: 'multiple-choice' }, { text: { type: 'plain_text', text: 'Open Ended' }, value: 'open-ended' }, { text: { type: 'plain_text', text: 'Agree/Disagree Scale' }, value: 'agree-disagree' }, { text: { type: 'plain_text', text: '1-to-5 Scale' }, value: '1-to-5' }, { text: { type: 'plain_text', text: '1-to-10 Scale' }, value: '1-to-10' }, { text: { type: 'plain_text', text: 'NPS (0-10)' }, value: 'nps' } ];
    if (templates.length > 0) {
        blocks.push({ type: 'input', block_id: 'template_load_block', optional: true, label: { type: 'plain_text', text: 'Load from Template' }, element: { type: 'static_select', action_id: 'load_survey_template', placeholder: { type: 'plain_text', text: 'Choose a template' }, options: templates.map(t => ({ text: { type: 'plain_text', text: t.TemplateName }, value: t.TemplateName })) } });
        blocks.push({ type: 'divider' });
    }
    blocks.push( { type: 'header', text: { type: 'plain_text', text: 'Survey Introduction' } }, { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message (use [firstName])' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input', initial_value: viewData.introMessage || '' } } );
    questions.forEach((q, index) => {
        const i = index + 1;
        blocks.push({ type: 'divider' });
        blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*Question ${i}*` }] });
        blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Remove' }, style: 'danger', action_id: 'delete_question_button', value: `${i}` }] });
        blocks.push( { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}`, initial_value: q.questionText || '' } }, { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}`, initial_value: q.options ? q.options.join('\n') : '' } }, { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Question Type' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: questionTypeOptions.find(opt => opt.value === q.pollFormat) || questionTypeOptions[0], options: questionTypeOptions }} );
    });
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: questions.length === 0 ? '➕ Add a Question' : '➕ Add Another Question' }, action_id: 'add_question_button' }] });
    blocks.push({ type: 'divider' });
    blocks.push( { type: 'header', text: { type: 'plain_text', text: 'Settings' } }, { type: 'input', block_id: 'reminder_message_block', optional: true, label: { type: 'plain_text', text: 'Reminder Message (Optional)' }, element: { type: 'plain_text_input', multiline: true, action_id: 'reminder_message_input', placeholder: { type: 'plain_text', text: 'Hi [firstName], just a friendly reminder...' } } }, { type: 'input', block_id: 'reminder_schedule_block', optional: true, label: { type: 'plain_text', text: 'Reminder Frequency' }, element: { type: 'static_select', action_id: 'reminder_schedule_select', placeholder: { type: 'plain_text', text: 'Do not send reminders' }, options: [{ text: { type: 'plain_text', text: 'Every 8 hours' }, value: '8' }, { text: { type: 'plain_text', text: 'Every 24 hours' }, value: '24' }, { text: { type: 'plain_text', text: 'Every 3 days' }, value: '72' }] } }, { type: 'input', optional: true, block_id: 'template_save_block', label: { type: 'plain_text', text: 'Save as a new template?' }, element: { type: 'plain_text_input', action_id: 'template_save_name_input', placeholder: { type: 'plain_text', text: 'e.g., Q3 Engineering Feedback' } } } );
    blocks.push({ type: 'divider' });
    if (userGroups.length > 0) { blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } }); }
    blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select destinations' }, action_id: 'destinations_select' } });
    return blocks;
};

// --- Helper: Parse Modal State for View Updates ---
const parseModalState = (values) => {
    let questions = [];
    const questionKeys = Object.keys(values).filter(k => k.startsWith('question_block_')).map(k => parseInt(k.split('_')[2], 10)).sort((a,b) => a-b);
    for (const i of questionKeys) { questions.push({ questionText: values[`question_block_${i}`]?.[`question_input_${i}`]?.value || '', options: (values[`options_block_${i}`]?.[`options_input_${i}`]?.value || '').split('\n').filter(Boolean), pollFormat: values[`format_block_${i}`]?.[`format_select_${i}`]?.selected_option?.value || 'buttons', }); }
    return { introMessage: values.intro_message_block?.intro_message_input?.value || '', questions: questions, };
};

// --- Command Handlers ---
app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
        const [userGroups, templates] = await Promise.all([ getAllUserGroups(), getAllSurveyTemplates() ]);
        await client.views.open({ trigger_id: body.trigger_id, view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks({ userGroups, templates }) }, });
    } catch (error) { console.error("Modal open error:", error); }
});
app.command('/templates', async ({ ack, body, client }) => {
    await ack();
    const templates = await getAllSurveyTemplates();
    let blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Here are your saved templates.' } }];
    if (templates.length === 0) { blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No templates found. Save one via the `/ask` command._' } }); } else { templates.forEach(t => { blocks.push({ type: 'divider' }); blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${t.TemplateName}*` }, accessory: { type: 'button', text: { type: 'plain_text', text: 'Delete' }, style: 'danger', action_id: 'delete_template_button', value: t.TemplateName, confirm: { title: { type: 'plain_text', text: 'Are you sure?' }, text: { type: 'mrkdwn', text: `Delete the "${t.TemplateName}" template?` }, confirm: { type: 'plain_text', text: 'Delete' }, deny: { type: 'plain_text', text: 'Cancel' }}}, }); }); }
    await client.views.open({ trigger_id: body.trigger_id, view: { type: 'modal', title: { type: 'plain_text', text: 'Manage Templates' }, blocks } });
});

// --- Action Handlers ---
app.action(/^(add|delete)_question_button$|^load_survey_template$/, async ({ ack, body, client, action }) => {
    await ack();
    let viewData = parseModalState(body.view.state.values);
    if (action.action_id === 'add_question_button') { viewData.questions.push({}); } else if (action.action_id === 'delete_question_button') { const questionIndexToDelete = parseInt(action.value, 10) - 1; viewData.questions.splice(questionIndexToDelete, 1); } else if (action.action_id === 'load_survey_template') { const template = await getTemplateByName(action.selected_option.value); if (template) { viewData = JSON.parse(template.SurveyData); } }
    const [userGroups, templates] = await Promise.all([ getAllUserGroups(), getAllSurveyTemplates() ]);
    viewData.userGroups = userGroups;
    viewData.templates = templates;
    try { await client.views.update({ view_id: body.view.id, hash: body.view.hash, view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(viewData) }, });
    } catch(e) { console.error("View update failed:", e.data || e); }
});

app.action('delete_template_button', async ({ ack, action }) => {
    await ack();
    await deleteSurveyTemplate(action.value);
});

app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
    await ack();
    try {
        const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
        payload.messageTs = body.message.ts;
        payload.channelId = body.channel.id;
        const question = await getQuestionTextByIndex(payload.sheetName, payload.qIndex);
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'confirm_answer_submission',
                private_metadata: JSON.stringify(payload),
                title: { type: 'plain_text', text: 'Confirm Answer' },
                submit: { type: 'plain_text', text: 'Confirm' },
                blocks: [ { type: 'section', text: { type: 'mrkdwn', text: `Your answer for:\n*${question}*` } }, { type: 'section', text: { type: 'mrkdwn', text: `Is:\n>*${payload.label}*` } }]
            }
        });
    } catch (e) { console.error("Error in poll_response action:", e); }
});

app.action('multiple_choice_modal_button', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const { sheetName, qIndex } = JSON.parse(action.value);
        const surveyDef = await getSurveyDefinition(sheetName);
        const question = surveyDef.questions[qIndex];
        if (!question || !question.options) { return; }
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'multiple_choice_submission',
                private_metadata: JSON.stringify({ sheetName, qIndex, channelId: body.channel.id, messageTs: body.message.ts }),
                title: { type: 'plain_text', text: 'Select Your Answer(s)' },
                submit: { type: 'plain_text', text: 'Submit' },
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `*${question.questionText}*` } },
                    { type: 'input', block_id: 'multi_choice_input_block', label: { type: 'plain_text', text: 'Select all that apply:' }, element: { type: 'checkboxes', action_id: 'multi_choice_checkboxes', options: question.options.map(opt => ({ text: { type: 'mrkdwn', text: opt }, value: opt })) } }
                ]
            }
        });
    } catch (e) { console.error("Error in multiple_choice_modal_button action:", e); }
});

app.action('open_ended_answer_modal', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const { sheetName, qIndex } = JSON.parse(action.value);
        const question = await getQuestionTextByIndex(sheetName, qIndex);
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'open_ended_submission',
                private_metadata: JSON.stringify({ sheetName, qIndex, channelId: body.channel.id, messageTs: body.message.ts }),
                title: { type: 'plain_text', text: 'Your Answer' },
                submit: { type: 'plain_text', text: 'Submit' },
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: `*Question:*\n>${question}` } },
                    { type: 'input', block_id: 'open_ended_input_block', label: { type: 'plain_text', text: 'Please type your response below:' }, element: { type: 'plain_text_input', action_id: 'open_ended_input', multiline: true } }
                ]
            }
        });
    } catch(e) { console.error("Error opening open-ended modal:", e); }
});

// --- View Submission Handlers ---
app.view('poll_submission', async ({ ack, body, view, client }) => {
    await ack();
    const user = body.user.id;
    try {
        const values = view.state.values;
        const creatorInfo = await client.users.info({ user: user });
        const creatorName = creatorInfo.user.profile.real_name || creatorInfo.user.name;
        let finalConversationIds = new Set();
        (values.destinations_block.destinations_select.selected_conversations || []).forEach(id => finalConversationIds.add(id));
        const selectedGroupName = values.group_destination_block?.group_destination_select?.selected_option?.value;
        if (selectedGroupName) { const groupMembers = await getGroupMembers(selectedGroupName); groupMembers.forEach(id => finalConversationIds.add(id)); }
        const conversationIds = Array.from(finalConversationIds);
        if (conversationIds.length === 0) { await client.chat.postEphemeral({ user: user, channel: user, text: "⚠️ Survey not sent. You must select at least one destination channel or group." }); return; }
        const parsedData = parseModalState(values);
        const parsedQuestions = parsedData.questions.filter(q => q.questionText && q.questionText.trim() !== '');
        if (parsedQuestions.length === 0) { await client.chat.postEphemeral({ user: user, channel: user, text: "⚠️ Survey not sent. You must add at least one question." }); return; }
        const templateNameToSave = values.template_save_block?.template_save_name_input?.value;
        if (templateNameToSave) { await saveSurveyTemplate({ templateName: templateNameToSave, creatorId: user, surveyData: JSON.stringify(parsedData) }); }
        const questionTexts = parsedQuestions.map(q => q.questionText);
        const sheetName = `Survey - ${questionTexts[0].substring(0, 40).replace(/[/\\?%*:|'"<>]/g, '')} - ${Date.now()}`;
        const surveyDetails = { reminderMessage: values.reminder_message_block?.reminder_message_input?.value || '', reminderHours: parseInt(values.reminder_schedule_block?.reminder_schedule_select?.selected_option?.value || '0', 10), };
        const surveyDefJson = JSON.stringify(parsedData);
        await createNewSheetWithDetails(sheetName, creatorName, questionTexts, surveyDetails, surveyDefJson);
        let allBlocks = [];
        if (parsedData.introMessage) {
            allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: parsedData.introMessage } });
        }
        parsedQuestions.forEach((qData, index) => {
            const questionNumber = index + 1;
            allBlocks.push({ type: 'divider' });
            allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${questionNumber}. ${qData.questionText}*` } });
            allBlocks.push(buildQuestionActions(qData, sheetName, index));
        });
        const recipientsWithTs = [];
        for (const conversationId of conversationIds) {
            try {
                let personalizedBlocks = JSON.parse(JSON.stringify(allBlocks));
                if (conversationId.startsWith('U') && parsedData.introMessage) {
                    const userInfo = await client.users.info({ user: conversationId });
                    const firstName = userInfo.user.profile.first_name || userInfo.user.profile.real_name.split(' ')[0];
                    const introBlock = personalizedBlocks.find(b => b.type === 'section' && b.text.text === parsedData.introMessage);
                    if (introBlock) {
                        introBlock.text.text = introBlock.text.text.replace(/\[firstName\]/g, firstName);
                    }
                }
                const result = await client.chat.postMessage({ channel: conversationId, text: `You have a new survey from ${creatorName}`, blocks: personalizedBlocks });
                if (result.ts) { recipientsWithTs.push({ id: conversationId, ts: result.ts }); }
            } catch (error) { console.error(`Failed to send to ${conversationId}:`, error.data || error); }
        }
        if (recipientsWithTs.length > 0) { await saveRecipients(sheetName, recipientsWithTs); }
    } catch (error) {
        console.error("Error in poll_submission view handler:", error);
        await client.chat.postEphemeral({ user: user, channel: user, text: "Sorry, an unexpected error occurred. Please check the logs." });
    }
});

app.view('confirm_answer_submission', async ({ ack, body, view, client }) => {
    await ack();
    const user = body.user.id;
    const { channelId, messageTs, sheetName, label, qIndex } = JSON.parse(view.private_metadata);
    try {
        const history = await client.conversations.history({ channel: channelId, latest: messageTs, limit: 1, inclusive: true });
        const originalBlocks = history.messages[0].blocks;
        const userInfo = await client.users.info({ user });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const question = await getQuestionTextByIndex(sheetName, qIndex);
        if (await checkIfAnswered({ sheetName, user: userName, question })) {
            await client.chat.postEphemeral({ user, channel: channelId, text: "⏩ You've already answered this question." });
            return;
        }
        await saveOrUpdateResponse({ sheetName, user: userName, question, answer: label, timestamp: new Date().toISOString() });
        const blockToReplaceIndex = originalBlocks.findIndex(b => b.block_id === `actions_for_q_${qIndex}`);
        if (blockToReplaceIndex > -1) {
            const questionNumber = qIndex + 1;
            originalBlocks[blockToReplaceIndex] = {
                type: 'context',
                elements: [ { type: 'mrkdwn', text: `✅ *Question ${questionNumber}* — You answered: *${label}*` } ]
            };
            await client.chat.update({ ts: messageTs, channel: channelId, blocks: originalBlocks, text: 'Survey response updated.' });
        }
    } catch(e) {
        console.error("Error in confirm_answer_submission:", e);
        await client.chat.postEphemeral({ user, channel: channelId, text: "❌ Sorry, there was an error saving your answer." });
    }
});

app.view('multiple_choice_submission', async ({ ack, body, view, client }) => {
    await ack();
    const user = body.user.id;
    const { channelId, messageTs, qIndex, sheetName } = JSON.parse(view.private_metadata);
    try {
        const history = await client.conversations.history({ channel: channelId, latest: messageTs, limit: 1, inclusive: true });
        const originalBlocks = history.messages[0].blocks;
        const selectedOptions = view.state.values.multi_choice_input_block.multi_choice_checkboxes.selected_options;
        const answerLabels = selectedOptions.map(opt => opt.value);
        if (answerLabels.length === 0) { return; }
        const answerText = answerLabels.join(', ');
        const userInfo = await client.users.info({ user });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const question = await getQuestionTextByIndex(sheetName, qIndex);
        if (await checkIfAnswered({ sheetName, user: userName, question })) {
            await client.chat.postEphemeral({ user, channel: channelId, text: "⏩ You've already answered this question." });
            return;
        }
        await saveOrUpdateResponse({ sheetName, user: userName, question, answer: answerText, timestamp: new Date().toISOString() });
        const blockToReplaceIndex = originalBlocks.findIndex(b => b.block_id === `actions_for_q_${qIndex}`);
        if (blockToReplaceIndex > -1) {
            const questionNumber = qIndex + 1;
            const friendlyAnswers = answerLabels.map(a => `*${a}*`).join(', ');
            originalBlocks[blockToReplaceIndex] = {
                type: 'context',
                elements: [ { type: 'mrkdwn', text: `✅ *Question ${questionNumber}* — You answered: ${friendlyAnswers}` } ]
            };
            await client.chat.update({ ts: messageTs, channel: channelId, blocks: originalBlocks, text: 'Survey response updated.' });
        }
    } catch(e) {
        console.error("Error in multiple_choice_submission:", e);
        await client.chat.postEphemeral({ user, channel: channelId, text: "❌ Sorry, there was an error saving your answer." });
    }
});

app.view('open_ended_submission', async ({ ack, body, view, client }) => {
    await ack();
    const user = body.user.id;
    const { channelId, messageTs, qIndex, sheetName } = JSON.parse(view.private_metadata);
    try {
        const history = await client.conversations.history({ channel: channelId, latest: messageTs, limit: 1, inclusive: true });
        const originalBlocks = history.messages[0].blocks;
        const answerText = view.state.values.open_ended_input_block.open_ended_input.value;
        const userInfo = await client.users.info({ user: user });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const question = await getQuestionTextByIndex(sheetName, qIndex);
        if (await checkIfAnswered({ sheetName, user: userName, question })) {
            await client.chat.postEphemeral({ channel: channelId, user: user, text: "⏩ You've already answered this question." });
            return;
        }
        await saveOrUpdateResponse({ sheetName, user: userName, question, answer: answerText, timestamp: new Date().toISOString() });
        const blockToReplaceIndex = originalBlocks.findIndex(b => b.block_id === `actions_for_q_${qIndex}`);
        if (blockToReplaceIndex > -1) {
            const questionNumber = qIndex + 1;
            originalBlocks[blockToReplaceIndex] = {
                type: 'context',
                elements: [ { type: 'mrkdwn', text: `✅ *Question ${questionNumber}* — You answered.` } ]
            };
            await client.chat.update({ ts: messageTs, channel: channelId, blocks: originalBlocks, text: 'Survey response updated.' });
        }
    } catch(e) {
        console.error("Error in open_ended_submission:", e);
        await client.chat.postEphemeral({ channel: channelId, user: user, text: "❌ Sorry, there was an error saving your answer." });
    }
});

// --- Start the App ---
(async () => {
    await app.start(process.env.PORT || 3000);
    startScheduler(app.client);
    console.log('⚡️ Bolt app is running!');
})();
