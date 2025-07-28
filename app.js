// 1. All require statements should be at the top
const { App, ExpressReceiver } = require('@slack/bolt');
const { saveResponseToSheet } = require('./sheets');

// 2. Configure dotenv for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// 3. Create a receiver for HTTP mode
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Optional: Add a custom route for health checks
receiver.app.get('/', (req, res) => {
  res.status(200).send('App is up and running!');
});

// 4. Initialize the app ONCE
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver,
});

// Helper function to generate modal blocks dynamically
const generateModalBlocks = (questionCount = 1) => {
  let blocks = [];

  // Section for optional introductory content
  blocks.push(
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Survey Introduction (Optional)'
      }
    },
    {
      type: 'input',
      block_id: 'intro_message_block',
      optional: true,
      label: { type: 'plain_text', text: 'Introductory Message' },
      element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' }
    },
    {
      type: 'input',
      block_id: 'image_url_block',
      optional: true,
      label: { type: 'plain_text', text: 'Image or GIF URL' },
      element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } }
    },
    {
      type: 'input',
      block_id: 'video_url_block',
      optional: true,
      label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' },
      element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } }
    }
  );

  // Loop to create a set of blocks for each question
  for (let i = 1; i <= questionCount; i++) {
    blocks.push(
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } },
      { type: 'input', optional: true, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } },
      { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } },
      { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [ { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' } ] } }
    );
  }

  // Add the "Add Question" button
  blocks.push(
    { type: 'divider' },
    { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` } ] }
  );

  // The conversation selector for sending the survey
  blocks.push({
    type: 'input',
    block_id: 'destinations_block',
    label: { type: 'plain_text', text: 'Send survey to these users or channels' },
    element: {
      type: 'multi_conversations_select',
      placeholder: { type: 'plain_text', text: 'Select users and/or channels' },
      action_id: 'destinations_select',
      filter: {
        include: ["public", "private", "im"],
        exclude_bot_users: true
      },
      default_to_current_conversation: true
    }
  });

  return blocks;
};

// ... (app.command('/ask', ...) and app.action('add_question_button', ...) are unchanged)
app.command('/ask', async ({ ack, body, client }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: 'modal',
          callback_id: 'poll_submission',
          title: { type: 'plain_text', text: 'Create a New Survey' },
          submit: { type: 'plain_text', text: 'Send Survey' },
          blocks: generateModalBlocks(1)
        }
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
        view: {
          type: 'modal',
          callback_id: 'poll_submission',
          title: { type: 'plain_text', text: 'Create a New Survey' },
          submit: { type: 'plain_text', text: 'Send Survey' },
          blocks: generateModalBlocks(newQuestionCount)
        }
      });
    } catch (error) {
      console.error("Failed to update view:", error);
    }
});

// This listener handles the submission of the modal form
app.view('poll_submission', async ({ ack, body, view, client }) => {
    // ... This function is unchanged
    await ack();
    const values = view.state.values;
    const conversationIds = values.destinations_block.destinations_select.selected_conversations;
    let allBlocks = [];
    const introMessage = values.intro_message_block?.intro_message_input?.value;
    const imageUrl = values.image_url_block?.image_url_input?.value;
    const videoUrl = values.video_url_block?.video_url_input?.value;

    if (introMessage) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: introMessage } }); }
    if (imageUrl) { allBlocks.push({ type: 'image', image_url: imageUrl, alt_text: 'Survey introduction image' }); }
    if (videoUrl) { allBlocks.push({ type: 'section', text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` } }); }
    if (allBlocks.length > 0) { allBlocks.push({ type: 'divider' }); }

    const parsedQuestions = [];
    const questionKeys = Object.keys(values).filter(key => key.startsWith('question_block_'));
    for (const qKey of questionKeys) {
        const qIndex = qKey.split('_')[2];
        const questionText = values[qKey][`question_input_${qIndex}`].value;
        const optionsText = values[`options_block_${qIndex}`][`options_input_${qIndex}`].value;
        const pollFormat = values[`format_block_${qIndex}`][`format_select_${qIndex}`].selected_option.value;
        if (questionText && optionsText) {
            parsedQuestions.push({ questionText, options: optionsText.split('\n').filter(opt => opt.trim() !== ''), pollFormat });
        }
    }

    for (const [questionIndex, questionData] of parsedQuestions.entries()) {
        allBlocks.push({ type: 'header', text: { type: 'plain_text', text: questionData.questionText } });
        let responseBlock;
        const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
        switch (questionData.pollFormat) {
            case 'dropdown':
                responseBlock = { type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: JSON.stringify({ label, question: questionData.questionText }) })) }] };
                break;
            case 'checkboxes':
                responseBlock = { type: 'actions', elements: [{ type: 'checkboxes', action_id: baseActionId, options: questionData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: JSON.stringify({ label, question: questionData.questionText }) })) }] };
                break;
            case 'buttons':
            default:
                responseBlock = { type: 'actions', elements: questionData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label }, value: JSON.stringify({ label, question: questionData.questionText }), action_id: `${baseActionId}_btn${optionIndex}` })) };
                break;
        }
        allBlocks.push(responseBlock);
    }

    if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
        allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: 'submit_checkbox_answers' }] });
    }

    for (const conversationId of conversationIds) {
        try {
            await client.chat.postMessage({
                channel: conversationId,
                text: 'You have a new survey to complete!',
                blocks: allBlocks,
                unfurl_links: true,
                unfurl_media: true
            });
        } catch (error) {
            console.error(`Failed to send survey DM to ${conversationId}`, error);
        }
    }
});

// Generic handler to process and save a response
async function processAndSaveResponse(user, question, answer, timestamp) {
  await saveResponseToSheet({ user, question, answer, timestamp });
}

// Listener for buttons and dropdowns with "Other" logic
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();

  if (action.type !== 'button' && action.type !== 'static_select') return;
  
  const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);

  // NEW: Check if the user selected "Other"
  if (payload.label.trim().toLowerCase() === 'other') {
    // Open a modal to ask for specifics
    const metadata = {
        question: payload.question,
        channel_id: body.channel.id,
        message_ts: body.message.ts,
        response_block_id: body.actions[0].block_id
    };
    await client.views.open({
        trigger_id: body.trigger_id,
        view: {
            type: 'modal',
            callback_id: 'other_option_submission',
            private_metadata: JSON.stringify(metadata),
            title: { type: 'plain_text', text: 'Specify "Other"' },
            submit: { type: 'plain_text', text: 'Submit' },
            blocks: [
                {
                    type: 'input',
                    block_id: 'other_input_block',
                    label: { type: 'plain_text', text: `You selected "Other" for the question:\n*${payload.question}*` },
                    element: { type: 'plain_text_input', action_id: 'other_input', multiline: true }
                }
            ]
        }
    });
    return;
  }

  const userInfo = await client.users.info({ user: body.user.id });
  const userName = userInfo.user.profile.real_name || userInfo.user.name;

  await processAndSaveResponse(userName, payload.question, payload.label, new Date().toISOString());

  const channelId = body.channel.id;
  if (channelId.startsWith('U')) {
    const originalBlocks = body.message.blocks;
    const actionBlockId = body.actions[0].block_id;
    const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);

    if (blockIndexToReplace > -1) {
      const headerBlock = originalBlocks[blockIndexToReplace - 1];
      const confirmationBlock = {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${payload.label}*` }]
      };
      originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
    }
    
    await client.chat.update({
      channel: channelId,
      ts: body.message.ts,
      blocks: originalBlocks
    });

  } else {
    await client.chat.postEphemeral({
      channel: channelId,
      user: body.user.id,
      text: `✅ Thank you for your response to "*${payload.question}*". We've recorded your answer: *${payload.label}*`
    });
  }
});

// Listener for 'Submit Answers' (Checkboxes) with "Other" logic
app.action('submit_checkbox_answers', async ({ ack, body, client }) => {
    await ack();

    const checkboxStates = body.state.values;
    const actionBlockId = Object.keys(checkboxStates)[0]; // Get the block_id of the checkbox action
    const actionId = Object.keys(checkboxStates[actionBlockId])[0];
    const selectedOptions = checkboxStates[actionBlockId][actionId].selected_options;
    
    const otherOption = selectedOptions.find(opt => JSON.parse(opt.value).label.trim().toLowerCase() === 'other');
    const normalOptions = selectedOptions.filter(opt => JSON.parse(opt.value).label.trim().toLowerCase() !== 'other');

    // NEW: If "Other" is selected, trigger the modal
    if (otherOption) {
        const otherPayload = JSON.parse(otherOption.value);
        const metadata = {
            question: otherPayload.question,
            channel_id: body.channel.id,
            message_ts: body.message.ts,
            response_block_id: actionBlockId,
            // also pass along any other answers that were checked
            normal_answers: normalOptions.map(opt => JSON.parse(opt.value).label)
        };

        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'other_option_submission',
                private_metadata: JSON.stringify(metadata),
                title: { type: 'plain_text', text: 'Specify "Other"' },
                submit: { type: 'plain_text', text: 'Submit' },
                blocks: [
                    {
                        type: 'input',
                        block_id: 'other_input_block',
                        label: { type: 'plain_text', text: `You selected "Other" for the question:\n*${otherPayload.question}*` },
                        element: { type: 'plain_text_input', action_id: 'other_input', multiline: true }
                    }
                ]
            }
        });
        return;
    }

    // --- This part runs only if "Other" was NOT selected ---
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;

    // The rest of this listener is the original logic from the previous step
    // (processing non-"Other" answers)
    let answeredQuestions = [];
    for (const blockId in checkboxStates) {
        const actionId = Object.keys(checkboxStates[blockId])[0];
        const blockState = checkboxStates[blockId][actionId];
        if (blockState.type !== 'checkboxes' || blockState.selected_options.length === 0) continue;
        const answers = blockState.selected_options.map(opt => JSON.parse(opt.value));
        const questionText = answers[0].question;
        const answerLabels = answers.map(a => `"${a.label}"`).join(', ');
        answeredQuestions.push({ questionText, answerLabels, blockId });
        for (const answer of answers) {
            await processAndSaveResponse(userName, answer.question, answer.label, new Date().toISOString());
        }
    }
    if (answeredQuestions.length === 0) {
        await client.chat.postEphemeral({ user: body.user.id, channel: body.channel.id, text: "Please select at least one option before submitting." });
        return;
    }
    const channelId = body.channel.id;
    if (channelId.startsWith('U')) {
        let originalBlocks = body.message.blocks;
        for (const q of answeredQuestions) {
            const blockIndexToReplace = originalBlocks.findIndex(b => b.block_id === q.blockId);
            if (blockIndexToReplace > -1) {
                const headerBlock = originalBlocks[blockIndexToReplace - 1];
                const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${q.answerLabels}*` }] };
                originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
            }
        }
        const submitButtonIndex = originalBlocks.findIndex(b => b.type === 'actions' && b.elements[0]?.action_id === 'submit_checkbox_answers');
        if (submitButtonIndex > -1) { originalBlocks.splice(submitButtonIndex - 1, 2); }
        await client.chat.update({ channel: channelId, ts: body.message.ts, blocks: originalBlocks });
    } else {
        const confirmationText = answeredQuestions.map(q => `For "*${q.questionText}*", you selected: *${q.answerLabels}*`).join('\n');
        await client.chat.postEphemeral({ channel: channelId, user: body.user.id, text: `✅ Thank you! Your survey responses have been submitted.\n${confirmationText}` });
    }
});


// NEW: Listener for the "Other" specification modal
app.view('other_option_submission', async ({ ack, body, view, client }) => {
    const metadata = JSON.parse(view.private_metadata);
    const { question, channel_id, message_ts, response_block_id, normal_answers } = metadata;
    
    const otherText = view.state.values.other_input_block.other_input.value;
    const finalAnswer = `Other: ${otherText}`;

    await ack();

    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;

    // Save the "Other" response
    await processAndSaveResponse(userName, question, finalAnswer, new Date().toISOString());
    
    let allAnswersForConfirmation = [finalAnswer];

    // If there were other checkbox answers, save them too
    if (normal_answers && normal_answers.length > 0) {
        allAnswersForConfirmation.push(...normal_answers);
        for (const answer of normal_answers) {
            await processAndSaveResponse(userName, question, answer, new Date().toISOString());
        }
    }

    // Now, update the original message to show completion
    const confirmationText = allAnswersForConfirmation.map(a => `*${a}*`).join(', ');

    if (channel_id.startsWith('U')) {
        // Fetch the latest message blocks to avoid race conditions
        const result = await client.conversations.history({ channel: channel_id, latest: message_ts, limit: 1, inclusive: true });
        const originalBlocks = result.messages[0].blocks;
        
        const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === response_block_id);
        
        if (blockIndexToReplace > -1) {
            const headerBlock = originalBlocks[blockIndexToReplace - 1];
            const confirmationBlock = {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: ${confirmationText}` }]
            };
            originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);

            // If it was a checkbox survey, also remove the submit button
            const submitButtonIndex = originalBlocks.findIndex(b => b.type === 'actions' && b.elements[0]?.action_id === 'submit_checkbox_answers');
            if (submitButtonIndex > -1) { originalBlocks.splice(submitButtonIndex - 1, 2); }
        }

        await client.chat.update({
            channel: channel_id,
            ts: message_ts,
            blocks: originalBlocks
        });

    } else {
        // For public channels, just send an ephemeral confirmation
        await client.chat.postEphemeral({
            channel: channel_id,
            user: body.user.id,
            text: `✅ Thank you! For "*${question}*", we've recorded your answer(s): ${confirmationText}`
        });
    }
});

// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
