const { App, ExpressReceiver } = require('@slack/bolt');
const {
    createNewSheet,
    saveOrUpdateResponse,
    checkIfAnswered,
    saveUserGroup,
    getAllUserGroups,
    getGroupMembers,
    getQuestionTextByIndex,
} = require('./sheets');

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
        const response = await app.client.oauth.v2.access({ client_id: process.env.SLACK_CLIENT_ID, client_secret: process.env.SLACK_CLIENT_SECRET, code: req.query.code, });
        console.log('OAuth Response:', response);
        res.send('Your app has been successfully installed! You can close this window.');
    } catch (error) {
        console.error('OAuth Error:', error);
        res.status(500).send('Something went wrong during installation.');
    }
});

// --- Modal Generation Function ---
const generateModalBlocks = (questionCount = 1, userGroups = []) => {
    let blocks = [];
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Survey Introduction (Optional)' } }, { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input', placeholder: { type: 'plain_text', text: 'Hi [firstName], please complete this survey...' } } }, { type: 'input', block_id: 'image_url_block', optional: true, label: { type: 'plain_text', text: 'Image or GIF URL' }, element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } } }, { type: 'input', block_id: 'video_url_block', optional: true, label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' }, element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } } });
    for (let i = 1; i <= questionCount; i++) {
        blocks.push({ type: 'divider' }, { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } }, { type: 'input', optional: false, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } }, { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } }, {
            type: 'input',
            block_id: `format_block_${i}`,
            label: { type: 'plain_text', text: 'Question Type' },
            element: {
                type: 'static_select',
                action_id: `format_select_${i}`,
                initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' },
                options: [
                    { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' },
                    { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' },
                    { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' },
                    { text: { type: 'plain_text', text: 'Open Ended' }, value: 'open-ended' },
                    { text: { type: 'plain_text', text: 'Agree/Disagree Scale' }, value: 'agree-disagree' },
                    { text: { type: 'plain_text', text: '1-to-5 Scale' }, value: '1-to-5' },
                    { text: { type: 'plain_text', text: '1-to-10 Scale' }, value: '1-to-10' },
                    { text: { type: 'plain_text', text: 'NPS (0-10)' }, value: 'nps' },
                ]
            }
        });
    }
    blocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` }] });
    if (userGroups.length > 0) {
        blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } });
    }
    blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to these users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select users and/or channels' }, action_id: 'destinations_select', filter: { include: ["public", "private", "im"], exclude_bot_users: true } } });
    return blocks;
};

// --- Command Handlers ---
app.command('/ask', async ({ ack, body, client }) => {
    const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',');
    if (process.env.ALLOWED_USER_IDS && !allowedUsers.includes(body.user_id)) {
        await ack();
        await client.chat.postEphemeral({
            user: body.user_id,
            channel: body.channel_id,
            text: "Sorry, you are not authorized to use this command. Please contact the app administrator."
        });
        return;
    }

    await ack();
    try {
        const userGroups = await getAllUserGroups();
        await client.views.open({
            trigger_id: body.trigger_id,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(1, userGroups), },
        });
    } catch (error) {
        console.error("Failed to open survey modal:", error);
        await client.chat.postEphemeral({ user: body.user_id, channel: body.channel_id, text: "Sorry, there was an error opening the survey creator. Please check the logs.", });
    }
});

app.command('/groups', async ({ ack, body, client }) => {
    await ack();
    try {
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'manage_groups_view',
                title: { type: 'plain_text', text: 'Manage User Groups' },
                blocks: [
                    { type: 'section', text: { type: 'mrkdwn', text: 'Create a new group to easily send surveys to the same people.' } },
                    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Create New Group' }, style: 'primary', action_id: 'create_group_button' }] }
                ]
            }
        });
    } catch (error) { console.error(error); }
});

// --- Action Handlers ---
app.action('add_question_button', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const currentQuestionCount = parseInt(action.value, 10);
        const newQuestionCount = currentQuestionCount + 1;
        const userGroups = await getAllUserGroups();
        await client.views.update({
            view_id: body.view.id,
            hash: body.view.hash,
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(newQuestionCount, userGroups), },
        });
    } catch (error) { console.error("Failed to update view:", error); }
});

app.action('create_group_button', async ({ ack, body, client }) => {
    await ack();
    try {
        await client.views.push({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'create_group_submission',
                title: { type: 'plain_text', text: 'Create a New Group' },
                submit: { type: 'plain_text', text: 'Save Group' },
                blocks: [
                    { type: 'input', block_id: 'group_name_block', label: { type: 'plain_text', text: 'Group Name' }, element: { type: 'plain_text_input', action_id: 'group_name_input', placeholder: { type: 'plain_text', text: 'e.g., Engineering Team' } } },
                    { type: 'input', block_id: 'group_members_block', label: { type: 'plain_text', text: 'Select Members' }, element: { type: 'multi_users_select', action_id: 'group_members_select', placeholder: { type: 'plain_text', text: 'Select users' } } }
                ]
            }
        });
    } catch (error) { console.error(error); }
});

app.action(/^poll_response_.+$/, ({ ack, body, client, action }) => {
    ack(); // Acknowledge immediately
    (async () => {
        if (action.type !== 'button' && action.type !== 'static_select') return;
        const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);

        try {
            const question = await getQuestionTextByIndex(payload.sheetName, payload.qIndex);

            await client.views.open({
                trigger_id: body.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'confirm_answer_submission',
                    private_metadata: JSON.stringify(payload),
                    title: { type: 'plain_text', text: 'Confirm Your Answer' },
                    submit: { type: 'plain_text', text: 'Confirm' },
                    close: { type: 'plain_text', text: 'Cancel' },
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: `You selected an answer for:\n*${question}*` } },
                        { type: 'section', text: { type: 'mrkdwn', text: `Your answer:\n>*${payload.label}*` } },
                        { type: 'section', text: { type: 'mrkdwn', text: 'Are you sure you want to submit this answer?' } }
                    ]
                }
            });
        } catch (error) { console.error("Error in poll_response handler:", error); }
    })();
});

app.action('submit_checkbox_answers', ({ ack, body, client, action }) => {
    ack(); // Acknowledge immediately
    (async () => {
        const { sheetName } = JSON.parse(action.value);
        const checkboxStates = body.state.values;

        try {
            const userInfo = await client.users.info({ user: body.user.id });
            const userName = userInfo.user.profile.real_name || userInfo.user.name;
            const confirmationMessages = [];

            for (const blockId in checkboxStates) {
                const actionId = Object.keys(checkboxStates[blockId])[0];
                const selectedOptions = checkboxStates[blockId][actionId].selected_options;

                if (selectedOptions.length === 0) continue;

                const { qIndex } = JSON.parse(selectedOptions[0].value);
                const questionText = await getQuestionTextByIndex(sheetName, qIndex);

                const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question: questionText });
                if (alreadyAnswered) {
                    confirmationMessages.push(`⏩ Skipped "*${questionText}*" (already answered).`);
                    continue;
                }

                const answerLabels = selectedOptions.map(opt => JSON.parse(opt.value).label);
                const combinedAnswer = answerLabels.join(', ');

                await saveOrUpdateResponse({ sheetName, user: userName, question: questionText, answer: combinedAnswer, timestamp: new Date().toISOString() });

                const friendlyAnswers = answerLabels.map(a => `"${a}"`).join(', ');
                confirmationMessages.push(`✅ For "*${questionText}*", you answered: ${friendlyAnswers}`);
            }

            if (confirmationMessages.length > 0) {
                await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: `Thank you! Your responses have been submitted.\n\n${confirmationMessages.join('\n')}` });
            } else {
                await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "No new answers were selected to submit." });
            }
        } catch (error) {
            console.error("Error in checkbox handler:", error);
            await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "Sorry, there was an error submitting your answers." });
        }
    })();
});

app.action('open_ended_answer_modal', ({ ack, body, client, action }) => {
    ack(); // Acknowledge immediately
    (async () => {
        try {
            const { sheetName, qIndex } = JSON.parse(action.value);
            const question = await getQuestionTextByIndex(sheetName, qIndex);

            await client.views.open({
                trigger_id: body.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'open_ended_submission',
                    private_metadata: JSON.stringify({ sheetName, qIndex, channel_id: body.channel.id }),
                    title: { type: 'plain_text', text: 'Your Answer' },
                    submit: { type: 'plain_text', text: 'Submit' },
                    blocks: [
                        { type: 'section', text: { type: 'mrkdwn', text: `*Question:*\n>${question}` } },
                        { type: 'input', block_id: 'open_ended_input_block', label: { type: 'plain_text', text: 'Please type your response below:' }, element: { type: 'plain_text_input', action_id: 'open_ended_input', multiline: true } }
                    ]
                }
            });
        } catch (error) { console.error("Error opening open-ended modal:", error); }
    })();
});


// --- View Submission Handlers ---
app.view('poll_submission', async ({ ack, body, view, client }) => {
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
        await ack({ response_action: 'errors', errors: { destinations_block: 'Please select at least one destination or a group.' } });
        return;
    }
    await ack();
    try {
        const parsedQuestions = [];
        const questionKeys = Object.keys(values).filter(key => key.startsWith('question_block_'));

        for (const qKey of questionKeys) {
            const qIndex = qKey.split('_')[2];
            const questionText = values[qKey][`question_input_${qIndex}`]?.value;
            const pollFormat = values[`format_block_${qIndex}`][`format_select_${qIndex}`].selected_option.value;

            if (questionText) {
                let options = [];
                switch (pollFormat) {
                    case '1-to-5': options = ['1', '2', '3', '4', '5']; break;
                    case '1-to-10': options = Array.from({ length: 10 }, (_, i) => (i + 1).toString()); break;
                    case 'agree-disagree': options = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree']; break;
                    case 'nps': options = Array.from({ length: 11 }, (_, i) => i.toString()); break;
                    default:
                        const optionsText = values[`options_block_${qIndex}`][`options_input_${qIndex}`]?.value || '';
                        options = optionsText.split('\n').filter(opt => opt.trim() !== '');
                }

                if (['buttons', 'dropdown', 'checkboxes'].includes(pollFormat) && options.length === 0) {
                    continue; // Skip questions that need options but don't have them
                }

                parsedQuestions.push({ questionText, options, pollFormat });
            }
        }

        const introMessageTemplate = values.intro_message_block?.intro_message_input?.value;
        const imageUrl = values.image_url_block?.image_url_input?.value;
        const videoUrl = values.video_url_block?.video_url_input?.value;

        // If there are no valid questions, just send the intro content
        if (parsedQuestions.length === 0) {
            if (introMessageTemplate || imageUrl || videoUrl) {
                const fallbackText = introMessageTemplate ? `You have a new message: ${introMessageTemplate.substring(0, 50)}...` : 'You have a new message!';
                
                // ** MODIFICATION START **
                // Loop to personalize the intro message
                for (const conversationId of conversationIds) {
                    let personalizedBlocks = [];
                    let currentIntroText = introMessageTemplate || '';

                    if (introMessageTemplate) {
                         if (conversationId.startsWith('U')) { // It's a user
                            try {
                                const userInfo = await client.users.info({ user: conversationId });
                                const firstName = userInfo.user.profile.first_name || userInfo.user.profile.real_name.split(' ')[0];
                                currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, firstName);
                            } catch (e) {
                                console.error(`Failed to get user info for ${conversationId}, using fallback.`, e);
                                currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, 'there');
                            }
                        } else { // It's a channel
                            currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, 'Team');
                        }
                        personalizedBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: currentIntroText } });
                    }
                   
                    if (imageUrl) { personalizedBlocks.push({ type: 'image', image_url: imageUrl, alt_text: 'Survey introduction image' }); }
                    if (videoUrl) { personalizedBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` } }); }

                    if (personalizedBlocks.length > 0) {
                        try {
                            await client.chat.postMessage({ channel: conversationId, text: fallbackText, blocks: personalizedBlocks, unfurl_links: true, unfurl_media: true });
                        } catch (error) { console.error(`Failed to send survey to ${conversationId}`, error); }
                    }
                }
                 // ** MODIFICATION END **
            }
            return;
        }

        // --- If there are questions, create the sheet and question blocks ---
        const userInfo = await client.users.info({ user });
        const creatorName = userInfo.user.profile.real_name || userInfo.user.name;
        const questionTexts = parsedQuestions.map(q => q.questionText);
        const firstQuestion = parsedQuestions[0].questionText.substring(0, 50).replace(/[/\\?%*:|"<>]/g, '');
        const sheetName = `Survey - ${firstQuestion} - ${Date.now()}`;

        const sheetCreated = await createNewSheet(sheetName, creatorName, questionTexts);
        if (!sheetCreated) {
            await client.chat.postEphemeral({ user, channel: user, text: "There was an error creating a new Google Sheet." });
            return;
        }

        // Build the static part of the survey (the questions)
        let questionBlocks = [];
        for (const [questionIndex, qData] of parsedQuestions.entries()) {
            questionBlocks.push({ type: 'header', text: { type: 'plain_text', text: qData.questionText } });

            const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
            const valuePayload = (label) => JSON.stringify({ sheetName, label, qIndex: questionIndex });

            let responseBlock;
            switch (qData.pollFormat) {
                case 'open-ended':
                    responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '✍️ Answer Question' }, action_id: `open_ended_answer_modal`, value: JSON.stringify({ sheetName, qIndex: questionIndex }) }] };
                    break;
                case 'dropdown':
                    responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: qData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) }] };
                    break;
                case 'checkboxes':
                    responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'checkboxes', action_id: baseActionId, options: qData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) }] };
                    break;
                case 'buttons': case '1-to-5': case '1-to-10': case 'agree-disagree': case 'nps': default:
                    responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: qData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` })) };
                    break;
            }
            questionBlocks.push(responseBlock);
        }

        if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
            questionBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: `submit_checkbox_answers`, value: JSON.stringify({ sheetName }) }] });
        }

        // ** MODIFICATION START **
        // Loop through each destination to build and send a personalized message
        for (const conversationId of conversationIds) {
            let introBlocks = [];
            let currentIntroText = introMessageTemplate || '';
            
            if (introMessageTemplate) {
                if (conversationId.startsWith('U')) { // It's a user's DM
                    try {
                        const recipientInfo = await client.users.info({ user: conversationId });
                        // Use first name, or fall back to the first part of the real name
                        const firstName = recipientInfo.user.profile.first_name || recipientInfo.user.profile.real_name.split(' ')[0];
                        currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, firstName);
                    } catch (e) {
                        console.error(`Failed to get user info for ${conversationId}, using fallback.`, e);
                        // Fallback in case user info fails
                        currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, 'there');
                    }
                } else { // It's a channel
                    currentIntroText = introMessageTemplate.replace(/\[firstName\]/g, 'Team');
                }
                 introBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: currentIntroText } });
            }
           
            if (imageUrl) { introBlocks.push({ type: 'image', image_url: imageUrl, alt_text: 'Survey introduction image' }); }
            if (videoUrl) { introBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` } }); }

            // Add a divider if there's an intro AND questions
            if (introBlocks.length > 0 && questionBlocks.length > 0) {
                introBlocks.push({ type: 'divider' });
            }

            const finalBlocks = [...introBlocks, ...questionBlocks];

            try {
                await client.chat.postMessage({
                    channel: conversationId,
                    text: 'You have a new survey to complete!', // Fallback text for notifications
                    blocks: finalBlocks,
                    unfurl_links: true,
                    unfurl_media: true
                });
            } catch (error) {
                console.error(`Failed to send survey to ${conversationId}`, error);
            }
        }
        // ** MODIFICATION END **

    } catch (error) {
        console.error("Error processing poll submission:", error);
    }
});

app.view('create_group_submission', async ({ ack, body, view, client }) => {
    const groupName = view.state.values.group_name_block.group_name_input.value;
    const memberIds = view.state.values.group_members_block.group_members_select.selected_users;
    const creatorId = body.user.id;
    if (!groupName || memberIds.length === 0) {
        await ack({ response_action: 'errors', errors: { group_name_block: !groupName ? 'Group name cannot be empty.' : undefined, group_members_block: memberIds.length === 0 ? 'Please select at least one member.' : undefined } });
        return;
    }
    await ack();
    try {
        await saveUserGroup({ groupName: groupName, creatorId: creatorId, memberIds: memberIds.join(',') });
        await client.chat.postEphemeral({ channel: creatorId, user: creatorId, text: `✅ Your new group "*${groupName}*" has been saved.` });
    } catch (error) {
        console.error("Error saving group:", error);
        await client.chat.postEphemeral({ channel: creatorId, user: creatorId, text: `❌ There was an error saving your group.` });
    }
});

app.view('confirm_answer_submission', async ({ ack, body, view, client }) => {
    await ack();
    try {
        const { sheetName, label, qIndex } = JSON.parse(view.private_metadata);
        const user = body.user.id;

        const question = await getQuestionTextByIndex(sheetName, qIndex);
        const userInfo = await client.users.info({ user: user });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ channel: user, user: user, text: "You've already submitted an answer for this question." });
            return;
        }

        await saveOrUpdateResponse({
            sheetName,
            user: userName,
            question,
            answer: label,
            timestamp: new Date().toISOString()
        });

        await client.chat.postEphemeral({
            channel: user,
            user: user,
            text: `✅ Thanks! For "*${question}*", your answer "*${label}*" has been recorded.`
        });
    } catch (error) {
        console.error("Error in confirm_answer_submission:", error);
        await client.chat.postEphemeral({
            channel: body.user.id,
            user: body.user.id,
            text: "Sorry, there was an error saving your confirmed answer."
        });
    }
});

app.view('open_ended_submission', async ({ ack, body, view, client }) => {
    await ack();
    try {
        const metadata = JSON.parse(view.private_metadata);
        const { sheetName, qIndex, channel_id } = metadata;
        const answerText = view.state.values.open_ended_input_block.open_ended_input.value;

        const question = await getQuestionTextByIndex(sheetName, qIndex);
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ channel: channel_id, user: body.user.id, text: "You've already submitted an answer for this question." });
            return;
        }

        await saveOrUpdateResponse({
            sheetName,
            user: userName,
            question,
            answer: answerText,
            timestamp: new Date().toISOString()
        });

        await client.chat.postEphemeral({
            channel: channel_id,
            user: body.user.id,
            text: `✅ Thanks! For "*${question}*", we've recorded your answer.`
        });
    } catch (error) {
        console.error("Error saving open-ended response:", error);
        await client.chat.postEphemeral({
            channel: JSON.parse(view.private_metadata).channel_id,
            user: body.user.id,
            text: "Sorry, there was an error submitting your answer."
        });
    }
});

// --- Start the App ---
(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Bolt app is running!');
})();
