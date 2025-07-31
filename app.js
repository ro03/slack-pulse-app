const { App, ExpressReceiver } = require('@slack/bolt');
const {
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
        case 'open-ended':
            elements.push({ type: 'button', text: { type: 'plain_text', text: '✍️ Answer Question' }, action_id: `open_ended_answer_modal`, value: JSON.stringify({ sheetName, qIndex: questionIndex }) });
            break;
        case 'dropdown':
            elements.push({ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: questionOptions.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) });
            break;
        case 'checkboxes':
            // Note: Checkboxes in threaded messages are complex to handle. This example provides the UI.
            // A "Submit" button per message or a different interaction model might be needed.
            elements.push({ type: 'checkboxes', action_id: baseActionId, options: questionOptions.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) });
            break;
        case '1-to-5':
            questionOptions = ['1', '2', '3', '4', '5'];
            // falls through
        case '1-to-10':
            if (!questionOptions) questionOptions = Array.from({ length: 10 }, (_, i) => (i + 1).toString());
            // falls through
        case 'agree-disagree':
            if (!questionOptions) questionOptions = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];
            // falls through
        case 'nps':
             if (!questionOptions) questionOptions = Array.from({ length: 11 }, (_, i) => i.toString());
            // falls through
        case 'buttons':
        default:
            elements = questionOptions.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` }));
            break;
    }
    return { type: 'actions', elements: elements };
};

// --- Helper: Generate Survey Modal Blocks ---
const generateModalBlocks = (viewData = {}) => {
    const { questions = [], userGroups = [], templates = [] } = viewData;
    let blocks = [];

    const questionTypeOptions = [
        { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' },
        { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' },
        { text: { type: 'plain_text', text: 'Checkboxes' }, value: 'checkboxes' },
        { text: { type: 'plain_text', text: 'Open Ended' }, value: 'open-ended' },
        { text: { type: 'plain_text', text: 'Agree/Disagree Scale' }, value: 'agree-disagree' },
        { text: { type: 'plain_text', text: '1-to-5 Scale' }, value: '1-to-5' },
        { text: { type: 'plain_text', text: '1-to-10 Scale' }, value: '1-to-10' },
        { text: { type: 'plain_text', text: 'NPS (0-10)' }, value: 'nps' }
    ];

    if (templates.length > 0) {
        blocks.push({ type: 'input', block_id: 'template_load_block', optional: true, label: { type: 'plain_text', text: 'Load from Template' }, element: { type: 'static_select', action_id: 'load_survey_template', placeholder: { type: 'plain_text', text: 'Choose a template' }, options: templates.map(t => ({ text: { type: 'plain_text', text: t.TemplateName }, value: t.TemplateName })) } });
        blocks.push({ type: 'divider' });
    }

    blocks.push(
        { type: 'header', text: { type: 'plain_text', text: 'Survey Introduction' } },
        { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message (use [firstName])' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input', initial_value: viewData.introMessage || '' } }
    );

    questions.forEach((q, index) => {
        const i = index + 1;
        blocks.push({ type: 'divider' });
        blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*Question ${i}*` }] });
        blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Remove' }, style: 'danger', action_id: 'delete_question_button', value: `${i}` }] });
        blocks.push(
            { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}`, initial_value: q.questionText || '' } },
            { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}`, initial_value: q.options ? q.options.join('\n') : '' } },
            { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Question Type' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: questionTypeOptions.find(opt => opt.value === q.pollFormat) || questionTypeOptions[0], options: questionTypeOptions }}
        );
    });

    blocks.push({ type: 'divider' });
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: questions.length === 0 ? '➕ Add a Question' : '➕ Add Another Question' }, action_id: 'add_question_button' }] });
    blocks.push({ type: 'divider' });
    blocks.push(
        { type: 'header', text: { type: 'plain_text', text: 'Settings' } },
        { type: 'input', block_id: 'reminder_message_block', optional: true, label: { type: 'plain_text', text: 'Reminder Message (Optional)' }, element: { type: 'plain_text_input', multiline: true, action_id: 'reminder_message_input', placeholder: { type: 'plain_text', text: 'Hi [firstName], just a friendly reminder...' } } },
        { type: 'input', block_id: 'reminder_schedule_block', optional: true, label: { type: 'plain_text', text: 'Reminder Frequency' }, element: { type: 'static_select', action_id: 'reminder_schedule_select', placeholder: { type: 'plain_text', text: 'Do not send reminders' }, options: [{ text: { type: 'plain_text', text: 'Every 8 hours' }, value: '8' }, { text: { type: 'plain_text', text: 'Every 24 hours' }, value: '24' }, { text: { type: 'plain_text', text: 'Every 3 days' }, value: '72' }] } },
        { type: 'input', optional: true, block_id: 'template_save_block', label: { type: 'plain_text', text: 'Save as a new template?' }, element: { type: 'plain_text_input', action_id: 'template_save_name_input', placeholder: { type: 'plain_text', text: 'e.g., Q3 Engineering Feedback' } } }
    );
    blocks.push({ type: 'divider' });
    if (userGroups.length > 0) { blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } }); }
    blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select destinations' }, action_id: 'destinations_select' } });

    return blocks;
};

// --- Helper: Parse Modal State for View Updates ---
const parseModalState = (values) => {
    let questions = [];
    const questionKeys = Object.keys(values).filter(k => k.startsWith('question_block_')).map(k => parseInt(k.split('_')[2], 10)).sort((a,b) => a-b);
    
    for (const i of questionKeys) {
        questions.push({
            questionText: values[`question_block_${i}`]?.[`question_input_${i}`]?.value || '',
            options: (values[`options_block_${i}`]?.[`options_input_${i}`]?.value || '').split('\n').filter(Boolean),
            pollFormat: values[`format_block_${i}`]?.[`format_select_${i}`]?.selected_option?.value || 'buttons',
        });
    }

    return {
        introMessage: values.intro_message_block?.intro_message_input?.value || '',
        questions: questions,
    };
};

// --- Command Handlers ---
app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
        const [userGroups, templates] = await Promise.all([ getAllUserGroups(), getAllSurveyTemplates() ]);
        await client.views.open({
            trigger_id: body.trigger_id,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks({ userGroups, templates }) },
        });
    } catch (error) { console.error("Modal open error:", error); }
});

app.command('/templates', async ({ ack, body, client }) => {
    await ack();
    const templates = await getAllSurveyTemplates();
    let blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Here are your saved templates.' } }];
    if (templates.length === 0) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No templates found. Save one via the `/ask` command._' } });
    } else {
        templates.forEach(t => {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'section',
                text: { type: 'mrkdwn', text: `*${t.TemplateName}*` },
                accessory: { type: 'button', text: { type: 'plain_text', text: 'Delete' }, style: 'danger', action_id: 'delete_template_button', value: t.TemplateName, confirm: { title: { type: 'plain_text', text: 'Are you sure?' }, text: { type: 'mrkdwn', text: `Delete the "${t.TemplateName}" template?` }, confirm: { type: 'plain_text', text: 'Delete' }, deny: { type: 'plain_text', text: 'Cancel' }}},
            });
        });
    }
    await client.views.open({ trigger_id: body.trigger_id, view: { type: 'modal', title: { type: 'plain_text', text: 'Manage Templates' }, blocks } });
});

// --- Action Handlers ---
app.action(/^(add|delete)_question_button$|^load_survey_template$/, async ({ ack, body, client, action }) => {
    await ack();
    let viewData = parseModalState(body.view.state.values);

    if (action.action_id === 'add_question_button') {
        viewData.questions.push({});
    } else if (action.action_id === 'delete_question_button') {
        const questionIndexToDelete = parseInt(action.value, 10) - 1;
        viewData.questions.splice(questionIndexToDelete, 1);
    } else if (action.action_id === 'load_survey_template') {
        const template = await getTemplateByName(action.selected_option.value);
        if (template) { viewData = JSON.parse(template.SurveyData); }
    }
    
    const [userGroups, templates] = await Promise.all([ getAllUserGroups(), getAllSurveyTemplates() ]);
    viewData.userGroups = userGroups;
    viewData.templates = templates;

    try {
        await client.views.update({
            view_id: body.view.id,
            hash: body.view.hash,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(viewData) },
        });
    } catch(e) {
        console.error("View update failed:", e.data || e);
    }
});

app.action('delete_template_button', async ({ ack, action }) => {
    await deleteSurveyTemplate(action.value);
    await ack();
});

app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
    await ack();
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    payload.messageTs = body.message.ts;
    payload.channelId = body.channel.id;
    const question = await getQuestionTextByIndex(payload.sheetName, payload.qIndex);
    await client.views.open({
        trigger_id: body.trigger_id,
        view: { type: 'modal', callback_id: 'confirm_answer_submission', private_metadata: JSON.stringify(payload), title: { type: 'plain_text', text: 'Confirm Answer' }, submit: { type: 'plain_text', text: 'Confirm' }, blocks: [ { type: 'section', text: { type: 'mrkdwn', text: `Your answer for:\n*${question}*` } }, { type: 'section', text: { type: 'mrkdwn', text: `Is:\n>*${payload.label}*` } }] }
    });
});

// --- View Submission Handler ---
app.view('poll_submission', async ({ ack, body, view, client }) => {
    const values = view.state.values;
    const creatorInfo = await client.users.info({ user: body.user.id });
    const creatorName = creatorInfo.user.profile.real_name || creatorInfo.user.name;

    let finalConversationIds = new Set();
    (values.destinations_block.destinations_select.selected_conversations || []).forEach(id => finalConversationIds.add(id));
    const selectedGroupName = values.group_destination_block?.group_destination_select?.selected_option?.value;
    if (selectedGroupName) { (await getGroupMembers(selectedGroupName)).forEach(id => finalConversationIds.add(id)); }
    const conversationIds = Array.from(finalConversationIds);
    if (conversationIds.length === 0) {
        await ack({ response_action: 'errors', errors: { destinations_block: 'Please select at least one destination.' } });
        return;
    }
    
    const parsedData = parseModalState(values);
    const parsedQuestions = parsedData.questions.filter(q => q.questionText);
    if (parsedQuestions.length === 0) {
        await ack({ response_action: 'errors', errors: { add_question_button: "Please add at least one question." } });
        return;
    }
    
    await ack();

    const templateNameToSave = values.template_save_block?.template_save_name_input?.value;
    if (templateNameToSave) {
        await saveSurveyTemplate({ templateName: templateNameToSave, creatorId: body.user.id, surveyData: JSON.stringify(parsedData) });
    }

    const questionTexts = parsedQuestions.map(q => q.questionText);
    const sheetName = `Survey - ${questionTexts[0].substring(0, 40)} - ${Date.now()}`;
    const surveyDetails = {
        reminderMessage: values.reminder_message_block?.reminder_message_input?.value || '',
        reminderHours: parseInt(values.reminder_schedule_block?.reminder_schedule_select?.selected_option?.value || '0', 10),
    };
    await createNewSheetWithDetails(sheetName, creatorName, questionTexts, surveyDetails);

    const recipientsWithTs = [];
    for (const conversationId of conversationIds) {
        try {
            let introText = parsedData.introMessage;
            if (introText && conversationId.startsWith('U')) {
                const userInfo = await client.users.info({ user: conversationId });
                const firstName = userInfo.user.profile.first_name || userInfo.user.profile.real_name.split(' ')[0];
                introText = introText.replace(/\[firstName\]/g, firstName);
            }
            
            // --- Send Intro + First Question ---
            const firstQ = parsedQuestions[0];
            let firstMessageBlocks = [];
            if (introText) {
                firstMessageBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: introText } }, { type: 'divider' });
            }
            firstMessageBlocks.push({type: 'section', text: {type: 'mrkdwn', text: `*1. ${firstQ.questionText}*`}});
            firstMessageBlocks.push(buildQuestionActions(firstQ, sheetName, 0));

            const result = await client.chat.postMessage({ channel: conversationId, text: `You have a new survey: ${firstQ.questionText}`, blocks: firstMessageBlocks });
            const parentTs = result.ts;
            if (parentTs) recipientsWithTs.push({ id: conversationId, ts: parentTs });

            // --- Send remaining questions in a thread ---
            for (const [index, qData] of parsedQuestions.slice(1).entries()) {
                const questionNumber = index + 2;
                const questionIndexInSheet = index + 1;
                let questionBlocks = [
                    {type: 'section', text: {type: 'mrkdwn', text: `*${questionNumber}. ${qData.questionText}*`}},
                    buildQuestionActions(qData, sheetName, questionIndexInSheet)
                ];
                await client.chat.postMessage({ channel: conversationId, thread_ts: parentTs, text: `Question ${questionNumber}`, blocks: questionBlocks });
            }
        } catch (error) { console.error(`Failed to send to ${conversationId}:`, error.data || error); }
    }

    if (recipientsWithTs.length > 0) { await saveRecipients(sheetName, recipientsWithTs); }
});

app.view('confirm_answer_submission', async ({ ack, body, view, client }) => {
    await ack();
    const { sheetName, label, qIndex, messageTs, channelId } = JSON.parse(view.private_metadata);
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    const question = await getQuestionTextByIndex(sheetName, qIndex);

    if (await checkIfAnswered({ sheetName, user: userName, question })) {
        await client.chat.postEphemeral({ channel: channelId, user: body.user.id, thread_ts: messageTs, text: "⏩ You've already answered this question." });
        return;
    }

    await saveOrUpdateResponse({ sheetName, user: userName, question, answer: label, timestamp: new Date().toISOString() });
    await client.chat.postEphemeral({ channel: channelId, user: body.user.id, thread_ts: messageTs, text: `✅ Thanks! Your answer "*${label}*" has been recorded.` });
});

// --- Start the App ---
(async () => {
    await app.start(process.env.PORT || 3000);
    startScheduler(app.client);
    console.log('⚡️ Bolt app is running!');
})();
