const { App, ExpressReceiver } = require('@slack/bolt');
const {
    createNewSheet,
    saveOrUpdateResponse,
    checkIfAnswered,
    saveUserGroup,
    getAllUserGroups,
    getGroupMembers,
} = require('./sheets');

// A temporary in-memory store for checkbox selections before submission.
const checkboxSelections = {}; // e.g., { 'user_id': { 'sheetName_q_index': ['Answer 1', 'Answer 2'] } }

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// 1. Initialize the receiver
const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });

// 2. Initialize the Bolt App, passing in the receiver
const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver: receiver });

// 3. Define the health check route on the receiver
receiver.app.get('/', (req, res) => {
    res.status(200).send('App is up and running!');
});

// 4. Define the OAuth callback route on the receiver
receiver.app.get('/api/slack/callback', async (req, res) => {
    try {
        await app.client.oauth.v2.access({
            client_id: process.env.SLACK_CLIENT_ID,
            client_secret: process.env.SLACK_CLIENT_SECRET,
            code: req.query.code,
        });
        res.send('Your app has been successfully installed! You can close this window.');
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('Something went wrong during installation.');
    }
});

const generateModalBlocks = (questionCount = 1, userGroups = []) => {
    let blocks = [];
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Survey Introduction (Optional)' } }, { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' } }, { type: 'input', block_id: 'image_url_block', optional: true, label: { type: 'plain_text', text: 'Image or GIF URL' }, element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } } }, { type: 'input', block_id: 'video_url_block', optional: true, label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' }, element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } } });
    for (let i = 1; i <= questionCount; i++) {
        blocks.push({ type: 'divider' }, { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } }, { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } }, { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } }, { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [{ text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' }] } });
    }
    blocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` }] });

    if (userGroups.length > 0) {
        blocks.push({ type: 'divider' });
        blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } });
    }
    blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to these users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select users and/or channels' }, action_id: 'destinations_select', filter: { include: ["public", "private", "im"], exclude_bot_users: true } } });

    return blocks;
};

app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
        const userGroups = await getAllUserGroups();
        await client.views.open({
            trigger_id: body.trigger_id,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(1, userGroups) }
        });
    } catch (error) {
        console.error("Failed to open survey modal:", error);
    }
});

app.action('add_question_button', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const currentQuestionCount = parseInt(action.value, 10);
        const newQuestionCount = currentQuestionCount + 1;
        const userGroups = await getAllUserGroups();
        await client.views.update({
            view_id: body.view.id,
            hash: body.view.hash,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(newQuestionCount, userGroups) }
        });
    } catch (error) {
        console.error("Failed to update view:", error);
    }
});

app.view('poll_submission', async ({ ack, body, view, client }) => {
    await ack();

    try {
        const values = view.state.values;
        const user = body.user.id;

        let finalConversationIds = new Set();
        const manualDestinations = values.destinations_block.destinations_select.selected_conversations || [];
        manualDestinations.forEach(id => finalConversationIds.add(id));
        const selectedGroupName = values.group_destination_block?.group_destination_select?.selected_option?.value;

        if (selectedGroupName) {
            const groupMemberIds = await getGroupMembers(selectedGroupName);
            groupMemberIds.forEach(id => finalConversationIds.add(id));
        }
        const conversationIds = Array.from(finalConversationIds);

        if (conversationIds.length === 0) {
            await client.chat.postEphemeral({ user: user, channel: user, text: 'Error: Please select at least one destination.' });
            return;
        }

        const parsedQuestions = [];
        const questionKeys = Object.keys(values).filter(key => key.startsWith('question_block_'));
        for (const qKey of questionKeys) {
            const qIndex = qKey.split('_')[2];
            const questionText = values[qKey][`question_input_${qIndex}`]?.value;
            const optionsText = values[`options_block_${qIndex}`][`options_input_${qIndex}`]?.value;
            if (questionText && optionsText) {
                const pollFormat = values[`format_block_${qIndex}`][`format_select_${qIndex}`].selected_option.value;
                parsedQuestions.push({ questionText, options: optionsText.split('\n').filter(opt => opt.trim() !== ''), pollFormat });
            }
        }

        let allBlocks = [];
        const introMessage = values.intro_message_block?.intro_message_input?.value;
        const imageUrl = values.image_url_block?.image_url_input?.value;
        const videoUrl = values.video_url_block?.video_url_input?.value;
        if (introMessage) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: introMessage } }); }
        if (imageUrl) { allBlocks.push({ type: 'image', image_url: imageUrl, alt_text: 'Survey introduction image' }); }
        if (videoUrl) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` } }); }

        if (parsedQuestions.length === 0) {
            if (allBlocks.length > 0) {
                 for (const conversationId of conversationIds) {
                    if (conversationId.startsWith('C')) { await client.conversations.join({ channel: conversationId }); }
                    await client.chat.postMessage({ channel: conversationId, text: 'You have a new message', blocks: allBlocks, unfurl_links: true, unfurl_media: true });
                }
            }
            return;
        }

        const userInfo = await client.users.info({ user: body.user.id });
        const creatorName = userInfo.user.profile.real_name || userInfo.user.name;
        const questionTexts = parsedQuestions.map(q => q.questionText);
        const firstQuestion = parsedQuestions[0].questionText.substring(0, 50).replace(/[/\\?%*:|"<>]/g, '');
        const sheetName = `Survey - ${firstQuestion} - ${Date.now()}`;
        const sheetCreated = await createNewSheet(sheetName, creatorName, questionTexts);

        if (!sheetCreated) {
            await client.chat.postEphemeral({ user, channel: user, text: "Error creating a new Google Sheet." });
            return;
        }
        if (allBlocks.length > 0) { allBlocks.push({ type: 'divider' }); }

        for (const [questionIndex, questionData] of parsedQuestions.entries()) {
            allBlocks.push({ type: 'header', text: { type: 'plain_text', text: questionData.questionText } });
            let responseBlock;
            const actionIdPrefix = `poll_response_${Date.now()}_q${questionIndex}`;
            const valuePayload = (label) => JSON.stringify({ sheetName, label, question: questionData.questionText });

            switch (questionData.pollFormat) {
                case 'dropdown':
                    responseBlock = { type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: `${actionIdPrefix}_dropdown`, options: questionData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) }] };
                    break;
                case 'checkboxes':
                    responseBlock = { type: 'actions', elements: [{ type: 'checkboxes', action_id: `${actionIdPrefix}_checkboxes`, options: questionData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) }] };
                    break;
                default:
                    responseBlock = { type: 'actions', elements: questionData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label }, value: valuePayload(label), action_id: `${actionIdPrefix}_btn${optionIndex}` })) };
                    break;
            }
            allBlocks.push(responseBlock);
        }
        if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
            allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: `submit_checkbox_answers`, value: JSON.stringify({ sheetName }) }] });
        }
        for (const conversationId of conversationIds) {
            if (conversationId.startsWith('C')) { await client.conversations.join({ channel: conversationId }); }
            await client.chat.postMessage({ channel: conversationId, text: 'You have a new survey to complete!', blocks: allBlocks, unfurl_links: true, unfurl_media: true });
        }
    } catch (error) {
        console.error("Error processing poll submission:", error);
        await client.chat.postEphemeral({ user: body.user.id, channel: body.user.id, text: "Sorry, something went wrong creating your survey." });
    }
});


// --- Response Action Handlers ---

// Generic handler for single-answer responses (Buttons, Dropdown)
const handleSingleAnswer = async ({ ack, action, body, client }) => {
    await ack();
    try {
        const payload = action.type === 'static_select' ? action.selected_option.value : action.value;
        const { sheetName, label, question } = JSON.parse(payload);
        const user = body.user.id;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ user, channel: body.channel.id, text: "You've already answered this question! Your first answer is recorded." });
            return;
        }

        await saveOrUpdateResponse({ sheetName, user, question, answer: label, timestamp: new Date().toISOString() });
        await client.chat.postEphemeral({ user, channel: body.channel.id, text: `✅ Your answer, "${label}", has been recorded.` });
    } catch (error) {
        console.error('Error processing single-answer response:', error);
    }
};

// Handler for Buttons (uses regex to match generated action_id)
app.action(/^poll_response_.*_btn\d+$/, handleSingleAnswer);

// Handler for Dropdowns (uses regex to match generated action_id)
app.action(/^poll_response_.*_dropdown$/, handleSingleAnswer);

// Handler for Checkbox selections (stores selections temporarily)
app.action(/^poll_response_.*_checkboxes$/, async ({ ack, action, body }) => {
    await ack();
    const user = body.user.id;
    if (!checkboxSelections[user]) {
        checkboxSelections[user] = {};
    }
    const { sheetName, question } = JSON.parse(action.selected_options[0].value); // Get context from first option
    const selectedLabels = action.selected_options.map(opt => JSON.parse(opt.value).label);
    const selectionKey = `${sheetName}__${question}`;
    checkboxSelections[user][selectionKey] = selectedLabels;
});

// Handler for the final "Submit" button for checkbox questions
app.action('submit_checkbox_answers', async ({ ack, body, client }) => {
    await ack();
    const user = body.user.id;
    const userSelections = checkboxSelections[user];

    if (!userSelections || Object.keys(userSelections).length === 0) {
        await client.chat.postEphemeral({ user, channel: body.channel.id, text: "You haven't selected any answers. Please check some boxes before submitting." });
        return;
    }

    try {
        let answersRecordedCount = 0;
        for (const [key, answers] of Object.entries(userSelections)) {
            const [sheetName, question] = key.split('__');
            const combinedAnswer = answers.join(', '); // Combine answers into a single string

            await saveOrUpdateResponse({ sheetName, user, question, answer: combinedAnswer, timestamp: new Date().toISOString() });
            answersRecordedCount++;
        }

        await client.chat.postEphemeral({ user, channel: body.channel.id, text: `✅ Success! Your ${answersRecordedCount} answer(s) have been submitted.` });
        
        // Clear the stored selections for the user
        delete checkboxSelections[user];

    } catch (error) {
        console.error('Error submitting checkbox answers:', error);
        await client.chat.postEphemeral({ user, channel: body.channel.id, text: "Sorry, there was an error submitting your answers." });
    }
});


// --- Group Management ---

app.command('/creategroup', async ({ ack, body, client }) => {
    await ack();
    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'group_creation_submission',
                title: { type: 'plain_text', text: 'Create User Group' },
                submit: { type: 'plain_text', text: 'Create' },
                blocks: [
                    { type: 'input', block_id: 'group_name_block', label: { type: 'plain_text', text: 'Group Name' }, element: { type: 'plain_text_input', action_id: 'group_name_input' } },
                    { type: 'input', block_id: 'group_members_block', label: { type: 'plain_text', text: 'Group Members' }, element: { type: 'multi_users_select', placeholder: { type: 'plain_text', text: 'Select users' }, action_id: 'group_members_select' } }
                ]
            }
        });
    } catch (error) {
        console.error('Failed to open group creation modal:', error);
    }
});

app.view('group_creation_submission', async ({ ack, body, view, client }) => {
    const groupName = view.state.values.group_name_block.group_name_input.value;
    const memberIds = view.state.values.group_members_block.group_members_select.selected_users.join(',');
    const creatorId = body.user.id;

    if (!groupName || !memberIds) {
        await ack({
            response_action: 'errors',
            errors: {
                group_name_block: 'Group name cannot be empty.',
                group_members_block: 'You must select at least one member.'
            }
        });
        return;
    }
    
    await ack();

    try {
        await saveUserGroup({ groupName, creatorId, memberIds });
        await client.chat.postEphemeral({
            user: creatorId,
            channel: creatorId,
            text: `Successfully created the user group "${groupName}"!`
        });
    } catch (error) {
        console.error('Error saving user group:', error);
        await client.chat.postEphemeral({
            user: creatorId,
            channel: creatorId,
            text: `There was an error creating the group "${groupName}". Please check the logs.`
        });
    }
});


(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();
