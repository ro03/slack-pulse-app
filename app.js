const { App, ExpressReceiver } = require('@slack/bolt');
const {
    // New/Updated Functions
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
    getSurveyDetails,
    getIncompleteUsers,
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
// ... (rest of your express routes are unchanged)

// --- Helper: Generate Survey Modal Blocks ---
const generateModalBlocks = (viewData = {}) => {
    const { questionCount = 0, userGroups = [], templates = [], values = {} } = viewData;
    let blocks = [];

    // --- Template Loading ---
    if (templates.length > 0) {
        blocks.push({
            type: 'input',
            block_id: 'template_load_block',
            optional: true,
            label: { type: 'plain_text', text: 'Load from Template' },
            element: {
                type: 'static_select',
                action_id: 'load_survey_template',
                placeholder: { type: 'plain_text', text: 'Choose a template' },
                options: templates.map(t => ({ text: { type: 'plain_text', text: t.TemplateName }, value: t.TemplateName })),
            },
        });
        blocks.push({ type: 'divider' });
    }

    // --- Introduction Section ---
    blocks.push(
        { type: 'header', text: { type: 'plain_text', text: 'Survey Introduction' } },
        { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message (use [firstName] to tag user)' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input', initial_value: values.introMessage || '' } }
    );

    // --- Questions Section ---
    for (let i = 1; i <= questionCount; i++) {
        blocks.push({ type: 'divider' });
        blocks.push({
            type: 'context',
            elements: [
                { type: 'mrkdwn', text: `*Question ${i}*` },
            ],
        });
        blocks.push({
            type: 'actions',
            elements: [{
                type: 'button',
                text: { type: 'plain_text', text: 'Remove', emoji: true },
                style: 'danger',
                action_id: `delete_question_button`,
                value: `${i}`,
            }]
        });
        blocks.push(
            { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}`, initial_value: values[`q_${i}_text`] || '' } },
            { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}`, initial_value: values[`q_${i}_options`] || '' } },
            // ... (format select block unchanged, add initial_value if needed)
        );
    }

    // --- Add Question Button ---
    blocks.push({ type: 'divider' });
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: questionCount === 0 ? '➕ Add a Question' : '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` }] });

    // --- Reminder Section ---
    blocks.push({ type: 'divider' });
    blocks.push(
        { type: 'header', text: { type: 'plain_text', text: 'Reminders (Optional)' } },
        { type: 'input', block_id: 'reminder_message_block', optional: true, label: { type: 'plain_text', text: 'Reminder Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'reminder_message_input', placeholder: { type: 'plain_text', text: 'Hi [firstName], just a friendly reminder to complete this survey.' } } },
        {
            type: 'input',
            block_id: 'reminder_schedule_block',
            optional: true,
            label: { type: 'plain_text', text: 'Reminder Frequency' },
            element: { type: 'static_select', action_id: 'reminder_schedule_select', placeholder: { type: 'plain_text', text: 'Do not send reminders' }, options: [ { text: { type: 'plain_text', text: 'Every 8 hours' }, value: '8' }, { text: { type: 'plain_text', text: 'Every 24 hours' }, value: '24' }, { text: { type: 'plain_text', text: 'Every 3 days' }, value: '72' }] }
        }
    );

    // --- Template Saving ---
    blocks.push({ type: 'divider' });
    blocks.push(
        { type: 'input', optional: true, block_id: 'template_save_block', label: { type: 'plain_text', text: 'Save as a new template?' }, element: { type: 'plain_text_input', action_id: 'template_save_name_input', placeholder: { type: 'plain_text', text: 'e.g., Q3 Engineering Feedback' } } }
    );
    
    // --- Destination Section ---
    blocks.push({ type: 'divider' });
    if (userGroups.length > 0) {
        blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } });
    }
    blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to these users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select users and/or channels' }, action_id: 'destinations_select' } });

    return blocks;
};

// --- Helper: Parse Modal State ---
const parseModalState = (values) => {
    const data = {
        questionCount: 0,
        values: {
            introMessage: values.intro_message_block?.intro_message_input?.value || '',
        }
    };
    const questionKeys = Object.keys(values).filter(k => k.startsWith('question_block_'));
    data.questionCount = questionKeys.length;

    for (const qKey of questionKeys) {
        const i = qKey.split('_')[2];
        data.values[`q_${i}_text`] = values[qKey][`question_input_${i}`]?.value || '';
        data.values[`q_${i}_options`] = values[`options_block_${i}`]?.[`options_input_${i}`]?.value || '';
        // ... add other fields like format if needed for preserving state
    }
    return data;
};

// --- Command Handlers ---
app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
        const [userGroups, templates] = await Promise.all([
            getAllUserGroups(),
            getAllSurveyTemplates(),
        ]);
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'poll_submission',
                title: { type: 'plain_text', text: 'Create a New Survey' },
                submit: { type: 'plain_text', text: 'Send Survey' },
                blocks: generateModalBlocks({ userGroups, templates }),
            },
        });
    } catch (error) { console.error("Failed to open survey modal:", error); }
});

app.command('/templates', async ({ ack, body, client }) => {
    await ack();
    try {
        const templates = await getAllSurveyTemplates();
        const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'Here are your saved survey templates. You can load them using the `/ask` command.' } }];

        if (templates.length === 0) {
            blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_No templates found. Create one using the "Save as template" option in the `/ask` modal._' } });
        } else {
            templates.forEach(template => {
                blocks.push({ type: 'divider' });
                blocks.push({
                    type: 'section',
                    text: { type: 'mrkdwn', text: `*${template.TemplateName}*` },
                    accessory: {
                        type: 'button',
                        text: { type: 'plain_text', text: 'Delete', emoji: true },
                        style: 'danger',
                        action_id: 'delete_template_button',
                        value: template.TemplateName,
                        confirm: {
                            title: { type: 'plain_text', text: 'Are you sure?' },
                            text: { type: 'mrkdwn', text: `This will permanently delete the "${template.TemplateName}" template.` },
                            confirm: { type: 'plain_text', text: 'Delete' },
                            deny: { type: 'plain_text', text: 'Cancel' },
                        },
                    },
                });
            });
        }

        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                title: { type: 'plain_text', text: 'Manage Templates' },
                blocks: blocks
            }
        });
    } catch (error) { console.error("Failed to open templates modal:", error); }
});


// --- Action Handlers ---

// Handles adding/deleting questions and loading templates
app.action(/^(add|delete)_question_button$|^load_survey_template$/, async ({ ack, body, client, action }) => {
    await ack();
    const view = body.view;
    const currentValues = view.state.values;
    let viewData = parseModalState(currentValues);

    if (action.action_id === 'add_question_button') {
        viewData.questionCount += 1;
    } else if (action.action_id === 'delete_question_button') {
        // This is simplified. A real implementation would need to remap all question values.
        viewData.questionCount = Math.max(0, viewData.questionCount - 1);
    } else if (action.action_id === 'load_survey_template') {
        const templateName = action.selected_option.value;
        const template = await getTemplateByName(templateName);
        if (template) {
            const templateData = JSON.parse(template.SurveyData);
            viewData.questionCount = templateData.questions.length;
            viewData.values.introMessage = templateData.introMessage;
            templateData.questions.forEach((q, i) => {
                viewData.values[`q_${i+1}_text`] = q.questionText;
                viewData.values[`q_${i+1}_options`] = (q.options || []).join('\n');
            });
        }
    }

    const [userGroups, templates] = await Promise.all([getAllUserGroups(), getAllSurveyTemplates()]);
    viewData.userGroups = userGroups;
    viewData.templates = templates;

    await client.views.update({
        view_id: view.id,
        hash: view.hash,
        view: {
            type: 'modal',
            callback_id: 'poll_submission',
            title: { type: 'plain_text', text: 'Create a New Survey' },
            submit: { type: 'plain_text', text: 'Send Survey' },
            blocks: generateModalBlocks(viewData),
        },
    });
});

app.action('delete_template_button', async ({ ack, body, client, action }) => {
    const templateName = action.value;
    await deleteSurveyTemplate(templateName);
    await ack();
    // Optionally, update the view to show the template is gone.
    // For simplicity, we can just let the user re-open the modal.
});

// This now needs to pass message.ts and channel.id for threaded replies
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
    await ack();
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    
    // Pass message context for threaded replies
    payload.messageTs = body.message.ts;
    payload.channelId = body.channel.id;

    const question = await getQuestionTextByIndex(payload.sheetName, payload.qIndex);

    await client.views.open({
        trigger_id: body.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'confirm_answer_submission',
            private_metadata: JSON.stringify(payload),
            title: { type: 'plain_text', text: 'Confirm Your Answer' },
            submit: { type: 'plain_text', text: 'Confirm' },
            blocks: [
                { type: 'section', text: { type: 'mrkdwn', text: `You selected an answer for:\n*${question}*` } },
                { type: 'section', text: { type: 'mrkdwn', text: `Your answer:\n>*${payload.label}*` } },
            ]
        }
    });
});


// --- View Submission Handlers ---

// This handler is now significantly more complex
app.view('poll_submission', async ({ ack, body, view, client }) => {
    // ... (logic to get conversationIds is the same)
    await ack();
    
    const values = view.state.values;
    const user = body.user.id;

    // --- Template Saving Logic ---
    const templateNameToSave = values.template_save_block?.template_save_name_input?.value;
    if (templateNameToSave) {
        // ... (Parse questions and save as template JSON)
        // await saveSurveyTemplate({ templateName: templateNameToSave, ... });
    }

    // --- Reminder Logic ---
    const reminderMessage = values.reminder_message_block?.reminder_message_input?.value || '';
    const reminderHours = values.reminder_schedule_block?.reminder_schedule_select?.selected_option?.value || '0';
    
    // --- Sheet Creation ---
    // ... (Parse questions into parsedQuestions array)
    // ... (Create sheetName)
    const surveyDetails = {
        reminderMessage: reminderMessage,
        reminderHours: parseInt(reminderHours, 10),
    };
    const sheetCreated = await createNewSheetWithDetails(sheetName, creatorName, questionTexts, surveyDetails);
    
    // --- Message Sending Logic (Threaded) ---
    const recipientsWithTs = [];
    for (const conversationId of conversationIds) {
        let parentTs = null;
        
        // Personalize intro message
        let personalizedIntro = ''; // ... logic to personalize intro
        
        const introAndFirstQuestionBlocks = [];
        if(personalizedIntro) introAndFirstQuestionBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: personalizedIntro } });
        // Add first question blocks to introAndFirstQuestionBlocks
        
        try {
            const result = await client.chat.postMessage({
                channel: conversationId,
                text: 'You have a new survey!',
                blocks: introAndFirstQuestionBlocks,
            });
            parentTs = result.ts;
            recipientsWithTs.push({ id: conversationId, ts: parentTs });

            // Loop through remaining questions and send as threaded replies
            for(const q of parsedQuestions.slice(1)) {
                await client.chat.postMessage({
                    channel: conversationId,
                    thread_ts: parentTs,
                    text: q.questionText,
                    blocks: [ /* blocks for this question */ ]
                });
            }
        } catch (error) { console.error(`Failed to send survey to ${conversationId}`, error); }
    }
    
    // Save the message timestamps for reminders
    if (recipientsWithTs.length > 0) {
        await saveRecipients(sheetName, recipientsWithTs);
    }
});

// This handler now posts a threaded ephemeral reply
app.view('confirm_answer_submission', async ({ ack, body, view, client }) => {
    await ack();
    const { sheetName, label, qIndex, messageTs, channelId } = JSON.parse(view.private_metadata);
    // ... (logic to get userName, question text, and check if already answered)
    
    await saveOrUpdateResponse({ sheetName, user: userName, question, answer: label, timestamp: new Date().toISOString() });
    
    // Post confirmation as a threaded, ephemeral reply
    await client.chat.postEphemeral({
        channel: channelId,
        user: body.user.id,
        thread_ts: messageTs,
        text: `✅ Thanks! For "*${question}*", your answer "*${label}*" has been recorded.`
    });
});


// --- Start the App ---
(async () => {
    await app.start(process.env.PORT || 3000);
    // Start the reminder scheduler
    startScheduler(app.client);
    console.log('⚡️ Bolt app is running!');
})();
