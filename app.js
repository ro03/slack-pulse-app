// app.js

const { App, ExpressReceiver } = require('@slack/bolt');
const { createNewSheet, saveOrUpdateResponse, checkIfAnswered } = require('./sheets');

const processingRequests = new Set();

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
receiver.app.get('/', (req, res) => { res.status(200).send('App is up and running!'); });
const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver: receiver });

// ... generateModalBlocks, /ask, add_question_button are unchanged from the previous version ...
const generateModalBlocks = (questionCount = 1) => {
    let blocks = [];
    blocks.push({type: 'header',text: {type: 'plain_text',text: 'Survey Introduction (Optional)'}},{type: 'input',block_id: 'intro_message_block',optional: true,label: { type: 'plain_text', text: 'Introductory Message' },element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' }},{type: 'input',block_id: 'image_url_block',optional: true,label: { type: 'plain_text', text: 'Image or GIF URL' },element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } }},{type: 'input',block_id: 'video_url_block',optional: true,label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' },element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } }});
    for (let i = 1; i <= questionCount; i++) {
        blocks.push({ type: 'divider' },{ type: 'header', text: { type: 'plain_text', text: `Question ${i}` } },{ type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } },{ type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } },{ type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [ { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' } ] } });
    }
    blocks.push({ type: 'divider' },{ type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` } ] });
    blocks.push({type: 'input',block_id: 'destinations_block',label: { type: 'plain_text', text: 'Send survey to these users or channels' },element: {type: 'multi_conversations_select',placeholder: { type: 'plain_text', text: 'Select users and/or channels' },action_id: 'destinations_select',filter: {include: ["public", "private", "im"],exclude_bot_users: true},default_to_current_conversation: true}});
    return blocks;
};
app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {type: 'modal',callback_id: 'poll_submission',title: { type: 'plain_text', text: 'Create a New Survey' },submit: { type: 'plain_text', text: 'Send Survey' },blocks: generateModalBlocks(1)}
      });
    } catch (error) {
      console.error(error);
    }
});
app.action('add_question_button', async ({ ack, body, client, action }) => {
    await ack();
    const currentQuestionCount = parseInt(action.value, 10);
    const newQuestionCount = currentQuestionCount + 1;
    try {
      await client.views.update({
        view_id: body.view.id,
        hash: body.view.hash,
        view: {type: 'modal',callback_id: 'poll_submission',title: { type: 'plain_text', text: 'Create a New Survey' },submit: { type: 'plain_text', text: 'Send Survey' },blocks: generateModalBlocks(newQuestionCount)}
      });
    } catch (error) {
      console.error("Failed to update view:", error);
    }
});


// MODIFIED: This view now handles cases with and without questions separately.
app.view('poll_submission', async ({ ack, body, view, client }) => {
    await ack();
    const values = view.state.values;
    const user = body.user.id;

    // --- Common logic for both cases ---
    // Parse questions from the modal
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

    // Build the introductory part of the message
    let allBlocks = [];
    const introMessage = values.intro_message_block?.intro_message_input?.value;
    const imageUrl = values.image_url_block?.image_url_input?.value;
    const videoUrl = values.video_url_block?.video_url_input?.value;
    if (introMessage) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: introMessage } }); }
    if (imageUrl) { allBlocks.push({ type: 'image', image_url: imageUrl, alt_text: 'Survey introduction image' }); }
    if (videoUrl) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` } }); }
    // --- End of Common logic ---


    // --- Logic Branching: With or Without Questions ---
    if (parsedQuestions.length === 0) {
        // CASE 1: No questions (send a message-only "survey")
        
        // Check if there's any content to send at all
        if (allBlocks.length === 0) {
            await client.chat.postEphemeral({
                user: user,
                channel: user,
                text: "You can't send an empty message. Please add an introductory message or some questions."
            });
            return;
        }
        
        const fallbackText = introMessage ? `You have a new message: ${introMessage.substring(0, 50)}...` : 'You have a new message!';
        const conversationIds = values.destinations_block.destinations_select.selected_conversations;

        for (const conversationId of conversationIds) {
            try {
                if (conversationId.startsWith('C')) {
                    await client.conversations.join({ channel: conversationId });
                }
                await client.chat.postMessage({
                    channel: conversationId,
                    text: fallbackText,
                    blocks: allBlocks,
                    unfurl_links: true,
                    unfurl_media: true
                });
            } catch (error) {
                console.error(`Failed to send message-only survey to ${conversationId}`, error);
            }
        }
    } else {
        // CASE 2: There are questions (original survey logic)

        // Create the Google Sheet for responses
        const userInfo = await client.users.info({ user: body.user.id });
        const creatorName = userInfo.user.profile.real_name || userInfo.user.name;
        const questionTexts = parsedQuestions.map(q => q.questionText);
        const firstQuestion = parsedQuestions[0].questionText.substring(0, 50).replace(/[/\\?%*:|"<>]/g, '');
        const sheetName = `Survey - ${firstQuestion} - ${Date.now()}`;
        const sheetCreated = await createNewSheet(sheetName, creatorName, questionTexts);

        if (!sheetCreated) {
            await client.chat.postEphemeral({ user, channel: user, text: "There was an error creating a new Google Sheet for this survey. Please check the logs." });
            return;
        }

        // Add a divider if there was an intro section
        if (allBlocks.length > 0) {
            allBlocks.push({ type: 'divider' });
        }

        // Add the question blocks to the message
        for (const [questionIndex, questionData] of parsedQuestions.entries()) {
            allBlocks.push({ type: 'header', text: { type: 'plain_text', text: questionData.questionText } });
            let responseBlock;
            const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
            const valuePayload = (label) => JSON.stringify({ sheetName, label, question: questionData.questionText });

            switch (questionData.pollFormat) {
                case 'dropdown':
                    responseBlock = { type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) }] };
                    break;
                case 'checkboxes':
                    responseBlock = { type: 'actions', elements: [{ type: 'checkboxes', action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) }] };
                    break;
                case 'buttons':
                default:
                    responseBlock = { type: 'actions', elements: questionData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` })) };
                    break;
            }
            allBlocks.push(responseBlock);
        }

        if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
            allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: `submit_checkbox_answers`, value: JSON.stringify({ sheetName }) }] });
        }

        // Send the full survey message
        const conversationIds = values.destinations_block.destinations_select.selected_conversations;
        for (const conversationId of conversationIds) {
            try {
                if (conversationId.startsWith('C')) {
                    await client.conversations.join({ channel: conversationId });
                }
                await client.chat.postMessage({channel: conversationId,text: 'You have a new survey to complete!',blocks: allBlocks,unfurl_links: true,unfurl_media: true});
            } catch (error) {
                console.error(`Failed to send survey to ${conversationId}`, error);
            }
        }
    }
});


// All other action handlers (poll_response, submit_checkbox_answers, other_option_submission) are unchanged
// ...
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button' && action.type !== 'static_select') return;
    
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    const { sheetName, question, label } = payload;
    const lockKey = `${body.user.id}:${sheetName}:${question}`;

    if (processingRequests.has(lockKey)) { return; }

    processingRequests.add(lockKey);
    try {
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "It looks like you've already answered this question." });
            return;
        }

        if (label.trim().toLowerCase() === 'other') {
            const metadata = { sheetName, question, channel_id: body.channel.id, message_ts: body.message.ts, response_block_id: body.actions[0].block_id };
            await client.views.open({
                trigger_id: body.trigger_id,
                view: { type: 'modal', callback_id: 'other_option_submission', private_metadata: JSON.stringify(metadata), title: { type: 'plain_text', text: 'Specify "Other"' }, submit: { type: 'plain_text', text: 'Submit' }, blocks: [{ type: 'input', block_id: 'other_input_block', label: { type: 'plain_text', text: `You selected "Other" for the question:\n*${question}*` }, element: { type: 'plain_text_input', action_id: 'other_input', multiline: true } }] }
            });
            return;
        }

        await saveOrUpdateResponse({ sheetName, user: userName, question, answer: label, timestamp: new Date().toISOString() });

        const channelId = body.channel.id;
        if (channelId.startsWith('U')) { 
            const originalBlocks = body.message.blocks;
            const actionBlockId = body.actions[0].block_id;
            const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);
            if (blockIndexToReplace > -1) {
                const headerBlock = originalBlocks[blockIndexToReplace - 1];
                const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${label}*` }] };
                originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
            }
            await client.chat.update({ channel: channelId, ts: body.message.ts, blocks: originalBlocks });
        } else {
            await client.chat.postEphemeral({ channel: channelId, user: body.user.id, text: `✅ Thank you for your response to "*${question}*". We've recorded your answer: *${label}*` });
        }
    } finally {
        processingRequests.delete(lockKey);
    }
});
app.action('submit_checkbox_answers', async ({ ack, body, client, action }) => {
    await ack();
    const { sheetName } = JSON.parse(action.value);
    
    const checkboxStates = body.state.values;
    const actionBlockId = Object.keys(checkboxStates)[0];
    const actionId = Object.keys(checkboxStates[actionBlockId])[0];
    const selectedOptions = checkboxStates[actionBlockId][actionId].selected_options;
    
    if (selectedOptions.length === 0) {
        await client.chat.postEphemeral({ user: body.user.id, channel: body.channel.id, text: "Please select at least one option before submitting." });
        return;
    }
    
    const questionText = JSON.parse(selectedOptions[0].value).question;
    const lockKey = `${body.user.id}:${sheetName}:${questionText}`;

    if (processingRequests.has(lockKey)) { return; }

    processingRequests.add(lockKey);
    try {
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question: questionText });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "It looks like you've already answered this question." });
            return;
        }

        const answerLabels = selectedOptions.map(opt => JSON.parse(opt.value).label);
        const otherOptionSelected = answerLabels.some(label => label.trim().toLowerCase() === 'other');
        
        if (otherOptionSelected) {
            const normalOptions = answerLabels.filter(label => label.trim().toLowerCase() !== 'other');
            const metadata = { sheetName, question: questionText, channel_id: body.channel.id, message_ts: body.message.ts, response_block_id: actionBlockId, normal_answers: normalOptions };
            await client.views.open({
                trigger_id: body.trigger_id,
                view: { type: 'modal', callback_id: 'other_option_submission', private_metadata: JSON.stringify(metadata), title: { type: 'plain_text', text: 'Specify "Other"' }, submit: { type: 'plain_text', text: 'Submit' }, blocks: [{ type: 'input', block_id: 'other_input_block', label: { type: 'plain_text', text: `You selected "Other" for the question:\n*${questionText}*` }, element: { type: 'plain_text_input', action_id: 'other_input', multiline: true } }] }
            });
            return;
        }

        const combinedAnswer = answerLabels.join(', ');
        await saveOrUpdateResponse({ sheetName, user: userName, question: questionText, answer: combinedAnswer, timestamp: new Date().toISOString() });

        const channelId = body.channel.id;
        const confirmationLabels = answerLabels.map(a => `"${a}"`).join(', ');

        if (channelId.startsWith('U')) {
            let originalBlocks = body.message.blocks;
            const blockIndexToReplace = originalBlocks.findIndex(b => b.block_id === actionBlockId);
            if (blockIndexToReplace > -1) {
                const headerBlock = originalBlocks[blockIndexToReplace - 1];
                const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${confirmationLabels}*` }] };
                originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
            }
            const submitButtonIndex = originalBlocks.findIndex(b => b.type === 'actions' && b.elements[0]?.action_id === 'submit_checkbox_answers');
            if (submitButtonIndex > -1) { originalBlocks.splice(submitButtonIndex - 1, 2); }
            await client.chat.update({ channel: channelId, ts: body.message.ts, blocks: originalBlocks });
        } else {
            const confirmationText = `For "*${questionText}*", you selected: *${confirmationLabels}*`;
            await client.chat.postEphemeral({ channel: channelId, user: body.user.id, text: `✅ Thank you! Your survey responses have been submitted.\n${confirmationText}` });
        }
    } finally {
        processingRequests.delete(lockKey);
    }
});
app.view('other_option_submission', async ({ ack, body, view, client }) => {
    const metadata = JSON.parse(view.private_metadata);
    const { sheetName, question, channel_id, message_ts, response_block_id, normal_answers } = metadata;
    const otherText = view.state.values.other_input_block.other_input.value;
    const finalAnswer = `Other: ${otherText}`;
    await ack();
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;

    let combinedAnswer = finalAnswer;
    let confirmationLabels = [finalAnswer];

    if (normal_answers && normal_answers.length > 0) {
        const allLabels = [...normal_answers, finalAnswer];
        combinedAnswer = allLabels.join(', ');
        confirmationLabels = allLabels;
    }
    
    await saveOrUpdateResponse({ sheetName, user: userName, question, answer: combinedAnswer, timestamp: new Date().toISOString() });
    
    const confirmationText = confirmationLabels.map(a => `*${a}*`).join(', ');

    if (channel_id.startsWith('U')) {
        const result = await client.conversations.history({ channel: channel_id, latest: message_ts, limit: 1, inclusive: true });
        const originalBlocks = result.messages[0].blocks;
        const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === response_block_id);
        if (blockIndexToReplace > -1) {
            const headerBlock = originalBlocks[blockIndexToReplace - 1];
            const confirmationBlock = {type: 'context',elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: ${confirmationText}` }]};
            originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
            const submitButtonIndex = originalBlocks.findIndex(b => b.type === 'actions' && b.elements[0]?.action_id === 'submit_checkbox_answers');
            if (submitButtonIndex > -1) { originalBlocks.splice(submitButtonIndex - 1, 2); }
        }
        await client.chat.update({channel: channel_id,ts: message_ts,blocks: originalBlocks});
    } else {
        await client.chat.postEphemeral({channel: channel_id,user: body.user.id,text: `✅ Thank you! For "*${question}*", we've recorded your answer(s): ${confirmationText}`});
    }
});
// ...

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
