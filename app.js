Of course. This is happening because your app's "Submit All My Answers" button logic is only designed to find and process the *first* checkbox question it encounters, ignoring any others.

-----

## 🧐 The Problem

In your `app.js` file, the `submit_checkbox_answers` action handler gets the state of all interactive components in the message via `body.state.values`. However, it then immediately grabs the key of the very first component (`Object.keys(checkboxStates)[0]`) and processes only that one, ending its work without looking for other checkbox questions.

-----

## ✅ The Solution

The handler must be rewritten to **loop through all question states** sent by Slack. For each one, it will find the question's index, look up the question text, and save the corresponding answers to your Google Sheet.

This involves two small changes in `app.js`:

1.  **In `poll_submission`:** The "Submit" button's `value` no longer needs a question index, just the `sheetName`.
2.  **In `submit_checkbox_answers`:** The entire function will be replaced with a new version that iterates correctly.

No changes are needed in `sheets.js`.

-----

## Corrected `app.js`

Here is the complete, updated `app.js` file with the necessary corrections.

```javascript
const { App, ExpressReceiver } = require('@slack/bolt');
const {
  createNewSheet,
  saveOrUpdateResponse,
  checkIfAnswered,
  saveUserGroup,
  getAllUserGroups,
  getGroupMembers,
} = require('./sheets');
const { google } = require('googleapis');

const processingRequests = new Set();

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// ... (Receiver, App, OAuth, and other handlers that are unchanged) ...
const receiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET });
const app = new App({ token: process.env.SLACK_BOT_TOKEN, receiver: receiver });
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
const generateModalBlocks = (questionCount = 1, userGroups = []) => {
  let blocks = [];
  blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Survey Introduction (Optional)' } }, { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' } }, { type: 'input', block_id: 'image_url_block', optional: true, label: { type: 'plain_text', text: 'Image or GIF URL' }, element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } } }, { type: 'input', block_id: 'video_url_block', optional: true, label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' }, element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } } });
  for (let i = 1; i <= questionCount; i++) {
    blocks.push({ type: 'divider' }, { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } }, { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } }, { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } }, { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [{ text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' }] } });
  }
  blocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` }] });
  if (userGroups.length > 0) {
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
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(1, userGroups), },
        });
    } catch (error) {
        console.error("Failed to open survey modal:", error);
        await client.chat.postEphemeral({ user: body.user_id, channel: body.channel_id, text: "Sorry, there was an error opening the survey creator. Please check the logs.", });
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
            view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(newQuestionCount, userGroups), },
        });
    } catch (error) {
        console.error("Failed to update view:", error);
    }
});

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
        await ack({
            response_action: 'errors',
            errors: { destinations_block: 'Please select at least one destination or a group.' },
        });
        return;
    }
    await ack();
    try {
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
            if (allBlocks.length === 0) {
                await client.chat.postEphemeral({ user, channel: user, text: "You can't send an empty message." });
                return;
            }
            const fallbackText = introMessage ? `You have a new message: ${introMessage.substring(0, 50)}...` : 'You have a new message!';
            for (const conversationId of conversationIds) {
                try {
                    await client.chat.postMessage({ channel: conversationId, text: fallbackText, blocks: allBlocks, unfurl_links: true, unfurl_media: true });
                } catch (error) { console.error(`Failed to send message-only post to ${conversationId}`, error); }
            }
        } else {
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
            if (allBlocks.length > 0) { allBlocks.push({ type: 'divider' }); }
            for (const [questionIndex, questionData] of parsedQuestions.entries()) {
                allBlocks.push({ type: 'header', text: { type: 'plain_text', text: questionData.questionText } });
                let responseBlock;
                const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
                const valuePayload = (label) => JSON.stringify({ sheetName, label, qIndex: questionIndex });
                switch (questionData.pollFormat) {
                    case 'dropdown':
                        responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) }] };
                        break;
                    case 'checkboxes':
                        responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'checkboxes', action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) }] };
                        break;
                    case 'buttons':
                    default:
                        responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: questionData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` })) };
                        break;
                }
                allBlocks.push(responseBlock);
            }
            if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
                // --- 💡 FIX: Only pass the sheetName to the submit button's value ---
                allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: `submit_checkbox_answers`, value: JSON.stringify({ sheetName }) }] });
            }
            for (const conversationId of conversationIds) {
                try {
                    await client.chat.postMessage({ channel: conversationId, text: 'You have a new survey to complete!', blocks: allBlocks, unfurl_links: true, unfurl_media: true });
                } catch (error) { console.error(`Failed to send survey to ${conversationId}`, error); }
            }
        }
    } catch (error) {
        console.error("Error processing poll submission:", error);
        await client.chat.postEphemeral({
            user: user,
            channel: user,
            text: "Sorry, something went wrong while creating your survey."
        });
    }
});

app.command('/groups', async ({ ack, body, client }) => {
  await ack();
  try { await client.views.open({ trigger_id: body.trigger_id, view: { type: 'modal', callback_id: 'manage_groups_view', title: { type: 'plain_text', text: 'Manage User Groups' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Create a new group to easily send surveys to the same people.' } }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Create New Group' }, style: 'primary', action_id: 'create_group_button' }] }] } });
  } catch (error) { console.error(error); }
});
app.action('create_group_button', async ({ ack, body, client }) => {
  await ack();
  try { await client.views.push({ trigger_id: body.trigger_id, view: { type: 'modal', callback_id: 'create_group_submission', title: { type: 'plain_text', text: 'Create a New Group' }, submit: { type: 'plain_text', text: 'Save Group' }, blocks: [{ type: 'input', block_id: 'group_name_block', label: { type: 'plain_text', text: 'Group Name' }, element: { type: 'plain_text_input', action_id: 'group_name_input', placeholder: { type: 'plain_text', text: 'e.g., Engineering Team' } } }, { type: 'input', block_id: 'group_members_block', label: { type: 'plain_text', text: 'Select Members' }, element: { type: 'multi_users_select', action_id: 'group_members_select', placeholder: { type: 'plain_text', text: 'Select users' } } }] } });
  } catch (error) { console.error(error); }
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
  try { await saveUserGroup({ groupName: groupName, creatorId: creatorId, memberIds: memberIds.join(',') }); await client.chat.postEphemeral({ channel: creatorId, user: creatorId, text: `✅ Your new group "*${groupName}*" has been saved.` });
  } catch (error) { console.error("Error saving group:", error); await client.chat.postEphemeral({ channel: creatorId, user: creatorId, text: `❌ There was an error saving your group.` }); }
});


async function getQuestionTextByIndex(sheetName, qIndex) {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const headerRes = await sheets.spreadsheets.values.get({ 
        spreadsheetId: process.env.GOOGLE_SHEET_ID, 
        range: `${sheetName}!1:1` 
    });
    const headers = headerRes.data.values[0];
    return headers[qIndex + 2];
}

app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  if (action.type !== 'button' && action.type !== 'static_select') return;
  const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
  const { sheetName, label, qIndex } = payload;
  try {
    const question = await getQuestionTextByIndex(sheetName, qIndex);
    const lockKey = `${body.user.id}:${sheetName}:${question}`;
    if (processingRequests.has(lockKey)) { return; }
    processingRequests.add(lockKey);
    try {
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question });
        if (alreadyAnswered) {
          await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "You've already answered this." });
          return;
        }
        if (label.trim().toLowerCase() === 'other') {
          const metadata = { sheetName, qIndex, channel_id: body.channel.id, message_ts: body.message.ts, response_block_id: body.actions[0].block_id };
          await client.views.open({
            trigger_id: body.trigger_id,
            view: { type: 'modal', callback_id: 'other_option_submission', private_metadata: JSON.stringify(metadata), title: { type: 'plain_text', text: 'Specify "Other"' }, submit: { type: 'plain_text', text: 'Submit' }, blocks: [{ type: 'input', block_id: 'other_input_block', label: { type: 'plain_text', text: `You selected "Other" for:\n*${question}*` }, element: { type: 'plain_text_input', action_id: 'other_input', multiline: true } }] }
          });
          return;
        }
        await saveOrUpdateResponse({ sheetName, user: userName, question, answer: label, timestamp: new Date().toISOString() });
        const channelId = body.channel.id;
        if (channelId.startsWith('U') || channelId.startsWith('D')) {
          const originalBlocks = body.message.blocks;
          const actionBlockId = body.actions[0].block_id;
          const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);
          if (blockIndexToReplace > -1) {
            const headerBlock = originalBlocks[blockIndexToReplace - 1];
            const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${label}*` }] };
            originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
          }
          await client.chat.update({ channel: channelId, ts: body.message.ts, text: "Response recorded.", blocks: originalBlocks });
        } else {
          await client.chat.postEphemeral({ channel: channelId, user: body.user.id, text: `✅ Thanks! For "*${question}*", you answered: *${label}*` });
        }
    } finally {
        processingRequests.delete(lockKey);
    }
  } catch(error) {
      console.error("Error in poll_response handler:", error);
  }
});


// --- 💡 REWRITTEN CHECKBOX HANDLER ---
app.action('submit_checkbox_answers', async ({ ack, body, client, action }) => {
    await ack();
    const { sheetName } = JSON.parse(action.value);
    const checkboxStates = body.state.values;

    try {
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const confirmationMessages = [];

        // Loop through each block state from the submission
        for (const blockId in checkboxStates) {
            const actionId = Object.keys(checkboxStates[blockId])[0];
            const selectedOptions = checkboxStates[blockId][actionId].selected_options;

            if (selectedOptions.length === 0) {
                continue; // Skip if no options were selected for this question
            }

            // Get the question index from the first selected option's value
            const { qIndex } = JSON.parse(selectedOptions[0].value);
            const questionText = await getQuestionTextByIndex(sheetName, qIndex);

            // Check if this question was already answered to prevent double submission
            const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question: questionText });
            if (alreadyAnswered) {
                confirmationMessages.push(`⏩ Skipped "*${questionText}*" (already answered).`);
                continue;
            }

            const answerLabels = selectedOptions.map(opt => JSON.parse(opt.value).label);
            const combinedAnswer = answerLabels.join(', ');

            // Save the combined answer to the sheet
            await saveOrUpdateResponse({
                sheetName,
                user: userName,
                question: questionText,
                answer: combinedAnswer,
                timestamp: new Date().toISOString()
            });

            // Add to the confirmation message
            const friendlyAnswers = answerLabels.map(a => `"${a}"`).join(', ');
            confirmationMessages.push(`✅ For "*${questionText}*", you answered: ${friendlyAnswers}`);
        }

        if (confirmationMessages.length > 0) {
            await client.chat.postEphemeral({
                channel: body.channel.id,
                user: body.user.id,
                text: `Thank you! Your responses have been submitted.\n\n${confirmationMessages.join('\n')}`
            });
        } else {
            await client.chat.postEphemeral({
                channel: body.channel.id,
                user: body.user.id,
                text: "No new answers were selected to submit."
            });
        }

    } catch (error) {
        console.error("Error in checkbox handler:", error);
        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: body.user.id,
            text: "Sorry, there was an error submitting your answers."
        });
    }
});


app.view('other_option_submission', async ({ ack, body, view, client }) => {
  const metadata = JSON.parse(view.private_metadata);
  const { sheetName, qIndex, channel_id, message_ts, response_block_id, normal_answers } = metadata;
  const otherText = view.state.values.other_input_block.other_input.value;
  const finalAnswer = `Other: ${otherText}`;
  await ack();
  try {
    const question = await getQuestionTextByIndex(sheetName, qIndex);
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
    if (channel_id.startsWith('U') || channel_id.startsWith('D')) {
      const result = await client.conversations.history({ channel: channel_id, latest: message_ts, limit: 1, inclusive: true });
      const originalBlocks = result.messages[0].blocks;
      const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === response_block_id);
      if (blockIndexToReplace > -1) {
        const headerBlock = originalBlocks[blockIndexToReplace - 1];
        const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: ${confirmationText}` }] };
        originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
        const submitButtonIndex = originalBlocks.findIndex(b => b.type === 'actions' && b.elements[0]?.action_id === 'submit_checkbox_answers');
        if (submitButtonIndex > -1) { originalBlocks.splice(submitButtonIndex - 1, 2); }
      }
      await client.chat.update({ channel: channel_id, ts: message_ts, text: "Response recorded.", blocks: originalBlocks });
    } else {
      await client.chat.postEphemeral({ channel: channel_id, user: body.user.id, text: `✅ Thanks! For "*${question}*", we've recorded: ${confirmationText}` });
    }
  } catch (error) {
      console.error("Error in other_option handler:", error);
  }
});


(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
