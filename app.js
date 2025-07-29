// 1. All require statements should be at the top
const { App, ExpressReceiver } = require('@slack/bolt');
const { saveResponseToSheet } = require('./sheets');
// ✨ FIX: The incorrect require('./views') line has been removed from here.

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

// ✨ NEW: Helper function to generate modal blocks dynamically
const generateModalBlocks = (questionCount = 1) => {
  let blocks = [];

// =================================================================
// SECTION 1: VIEW DEFINITIONS
// For better organization, we define the modal blocks in functions.
// =================================================================

/**
 * Gets the blocks for the initial main menu.
 */
const getMainMenuBlocks = () => {
  return [
  // --- NEW: Section for optional introductory content ---
  blocks.push(
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Create a new poll"
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Survey Introduction (Optional)'
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "What would you like to create?"
      }
      type: 'input',
      block_id: 'intro_message_block',
      optional: true,
      label: { type: 'plain_text', text: 'Introductory Message' },
      element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' }
    },
    {
			"type": "actions",
			"elements": [
				{
					"type": "button",
					"text": {
						"type": "plain_text",
						"text": "📊 Multiple Choice Survey",
						"emoji": true
					},
					"value": "multi_question_survey",
					"action_id": "open_poll_creation_view"
				}
			]
		},
    // You can add more buttons here for "Open Ended", "Q&A", etc.
  ];
};

/**
 * Gets the blocks for the main poll creation screen.
 * @param {object} metadata - The current state of the survey being built.
 */
const getPollCreationBlocks = (metadata) => {
    let blocks = [];

    // --- Introductory Content Section ---
    blocks.push(
      { type: 'header', text: { type: 'plain_text', text: 'Survey Content (Optional)' } },
      { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input', initial_value: metadata.intro_message || '' } },
    );

    // --- Loop to display existing questions ---
    metadata.questions.forEach((q, index) => {
        const questionNum = index + 1;
        blocks.push(
            { type: 'divider' },
            { type: 'section', text: { type: 'mrkdwn', text: `*Question ${questionNum}: ${q.questionText}*` } },
            { type: 'context', elements: [ { type: 'plain_text', text: `Options: ${q.options.join(', ')}` } ] }
        );
    });
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

    // --- Input fields for the *next* question ---
    const nextQuestionNum = metadata.questions.length + 1;
    blocks.push(
        { type: 'divider' },
        { type: 'header', text: { type: 'plain_text', text: `Add Question ${nextQuestionNum}` } },
        { type: 'input', block_id: `question_block_new`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_new` } },
        { type: 'input', block_id: `options_block_new`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_new` } },
        { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '➕ Add This Question' }, style: 'primary', action_id: 'add_question_button' } ] }
    );
    
    // --- Final configuration ---
  // Loop to create a set of blocks for each question
  for (let i = 1; i <= questionCount; i++) {
    blocks.push(
      { type: 'divider' },
      { type: 'input', block_id: 'channel_block', label: { type: 'plain_text', text: 'Post survey in this channel' }, element: { type: 'conversations_select', placeholder: { type: 'plain_text', text: 'Select a channel' }, action_id: 'channel_select', filter: { "include": [ "public" ] } } }
      { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } },
      { type: 'input', block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } },
      { type: 'input', block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } },
      { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [ { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' } ] } }
    );
  }

    return blocks;
};
  // Add the "Add Question" button
  blocks.push(
    { type: 'divider' },
    { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` } ] }
  );

  // Add the user selector at the end
  blocks.push({ type: 'input', block_id: 'users_block', label: { type: 'plain_text', text: 'Send survey to these users' }, element: { type: 'multi_users_select', placeholder: { type: 'plain_text', text: 'Select users' }, action_id: 'users_select' } });

// =================================================================
// SECTION 2: APP LISTENERS (COMMANDS AND ACTIONS)
// This is where the app responds to user interactions.
// =================================================================
  return blocks;
};

// --- Step 1: User types /ask, opening the Main Menu ---
// This command opens the initial survey creation modal
app.command('/ask', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        title: { type: 'plain_text', text: 'Polly-like App' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: getMainMenuBlocks()
        callback_id: 'poll_submission',
        title: { type: 'plain_text', text: 'Create a New Survey' },
        submit: { type: 'plain_text', text: 'Send Survey' },
        blocks: generateModalBlocks(1) // Start with 1 question
      }
    });
  } catch (error) {
    console.error(error);
  }
});

// --- Step 2: User clicks a button on the Main Menu, e.g., "Multiple Choice Survey" ---
app.action('open_poll_creation_view', async ({ ack, body, client, action }) => {
    await ack();

    // Initialize the state of our survey using private_metadata.
    // This is how we pass data between modal views.
    const metadata = {
        poll_type: action.value, // e.g., 'multi_question_survey'
        questions: [],
        intro_message: ''
    };

    try {
        // PUSH a new view onto the stack. The user can go "Back" to the main menu.
        await client.views.push({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'poll_submission', // This view has the submit button
                title: { type: 'plain_text', text: 'Create a Survey' },
                submit: { type: 'plain_text', text: 'Send Survey' },
                close: { type: 'plain_text', text: 'Cancel' },
                // Pass the initial state to the view
                private_metadata: JSON.stringify(metadata),
                blocks: getPollCreationBlocks(metadata)
            }
        });
    } catch (error) {
        console.error(error);
    }
});

// --- Step 3: User is in the creation view and clicks "Add This Question" ---
app.action('add_question_button', async ({ ack, body, client }) => {
    await ack();

    const view = body.view;
    const values = view.state.values;

    // Retrieve the current state from private_metadata
    let metadata = JSON.parse(view.private_metadata);

    // Get the new question and options from the input blocks
    const newQuestion = values.question_block_new.question_input_new.value;
    const newOptions = values.options_block_new.options_input_new.value;
// ✨ NEW: This listener handles the "Add Another Question" button click
app.action('add_question_button', async ({ ack, body, client, action }) => {
  await ack();

    if (newQuestion && newOptions) {
        metadata.questions.push({
            questionText: newQuestion,
            options: newOptions.split('\n').filter(opt => opt.trim() !== ''),
            pollFormat: 'buttons' // Hard-coded for this example
        });
    }
    
    // Also save the intro message if it has been typed
    metadata.intro_message = values.intro_message_block.intro_message_input.value || '';
  // Get the current number of questions from the button's value
  const currentQuestionCount = parseInt(action.value, 10);
  const newQuestionCount = currentQuestionCount + 1;

    try {
        // UPDATE the current view with the new state
        await client.views.update({
            view_id: view.id,
            hash: view.hash,
            view: {
                type: 'modal',
                callback_id: 'poll_submission',
                title: { type: 'plain_text', text: 'Create a Survey' },
                submit: { type: 'plain_text', text: 'Send Survey' },
                close: { type: 'plain_text', text: 'Cancel' },
                private_metadata: JSON.stringify(metadata),
                blocks: getPollCreationBlocks(metadata)
            }
        });
    } catch (error) {
        console.error("Failed to update view:", error);
    }
  try {
    // Update the view with a new set of blocks
    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash, // Required for view updates
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


// =================================================================
// SECTION 3: FINAL SUBMISSION HANDLING
// =================================================================

// This listener handles the submission of the modal form
app.view('poll_submission', async ({ ack, body, view, client }) => {
  // Acknowledge the view submission immediately
  await ack();

  const values = view.state.values;
  
  // Get the final state from the metadata
  const metadata = JSON.parse(view.private_metadata);
  const introMessage = values.intro_message_block.intro_message_input.value;
  const parsedQuestions = metadata.questions;
  const userIds = values.users_block.users_select.selected_users;

  // This will hold ALL blocks for the final survey message
  // --- NEW: This will hold ALL blocks for the single survey message ---
  let allBlocks = [];

  // --- NEW: Read and build the introductory blocks ---
  const introMessage = values.intro_message_block?.intro_message_input?.value;
  const imageUrl = values.image_url_block?.image_url_input?.value;
  const videoUrl = values.video_url_block?.video_url_input?.value;

  if (introMessage) {
    allBlocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: introMessage }
    });
  }
  if (imageUrl) {
    allBlocks.push({
      type: 'image',
      image_url: imageUrl,
      alt_text: 'Survey introduction image'
    });
  }
  if (videoUrl) {
    // For video, we post the link and let Slack "unfurl" it into an embedded player
    allBlocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `▶️ <${videoUrl}>` }
    });
  }

  // Add a divider if we had any intro content
  if (allBlocks.length > 0) {
    allBlocks.push({ type: 'divider' });
  }

  // Loop through the questions stored in metadata to build the message
  // Parse multiple questions from the view state
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

  // --- UPDATED: Loop through questions and ADD their blocks to the 'allBlocks' array ---
  for (const [questionIndex, questionData] of parsedQuestions.entries()) {

    // Use a header for each question to separate them visually
    allBlocks.push({
        type: 'header',
        text: { type: 'plain_text', text: questionData.questionText }
    });

    let responseBlock;
    const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
    const responseBlock = { 
        type: 'actions', 
        block_id: `actions_${questionIndex}`, 
        elements: questionData.options.map((label, optionIndex) => ({ 
            type: 'button', 
            text: { type: 'plain_text', text: label }, 
            value: JSON.stringify({ label, question: questionData.questionText }), 
            action_id: `${baseActionId}_btn${optionIndex}` 
        })) 
    };

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

  if (allBlocks.length === 0) {
    // Handle case where user submits without adding any questions
    console.log("User submitted an empty survey.");
    return;
  // Add a single "Submit" button at the very end for checkbox-based surveys
  if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
      allBlocks.push(
          { type: 'divider' },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers'}, style: 'primary', action_id: 'submit_checkbox_answers' }] }
      );
  }
  
  // Get the selected channel and post the survey
  const selectedChannel = values.channel_block.channel_select.selected_conversation;
  if (selectedChannel) {

  // --- UPDATED: Send the single, combined survey message to each user ---
  for (const userId of userIds) {
    try {
      await client.chat.postMessage({
        channel: selectedChannel,
        text: 'A new survey has been posted!',
        channel: userId,
        text: 'You have a new survey to complete!', // Fallback text for notifications
        blocks: allBlocks,
        unfurl_links: true, // This is needed to make video URLs expand
        unfurl_media: true
      });
    } catch (error) {
      console.error(`Failed to post survey to channel ${selectedChannel}`, error);
      console.error(`Failed to send survey DM to ${userId}`, error);
    }
  }
});


// =================================================================
// SECTION 4: RESPONSE HANDLING (No changes needed here)
// =================================================================
// --- The Response Handlers below remain unchanged from the previous version ---
// --- Replace your existing action listeners with these new versions ---

// Generic handler to process and save a response
async function processAndSaveResponse(user, question, answer, timestamp) {
  // This function doesn't need to change.
  await saveResponseToSheet({ user, question, answer, timestamp });
}

// Listener for button clicks on a poll
// Listener for buttons and dropdowns
// ✨ UPDATED: Listener for buttons and dropdowns that only updates the answered question
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  if (action.type === 'button') {
    const payload = JSON.parse(action.value);
  

  // This listener handles non-checkbox questions (buttons and dropdowns)
  if (action.type === 'button' || action.type === 'static_select') {
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    await client.chat.update({ channel: body.channel.id, ts: body.message.ts, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ Thank you, ${userName}! Your response "*${payload.label}*" has been recorded.` } }] });

    // 1. Get all the blocks from the original survey message
    const originalBlocks = body.message.blocks;
    

    // 2. Find the exact block that the user interacted with
    const actionBlockId = body.actions[0].block_id;
    const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);

    if (blockIndexToReplace > -1) {
      const headerBlock = originalBlocks[blockIndexToReplace - 1];
      originalBlocks.splice(blockIndexToReplace - 1, 2, {
      // 3. Create a new "confirmation" block to replace the question
      const headerBlock = originalBlocks[blockIndexToReplace - 1]; // Assumes a header is right before
      const confirmationBlock = {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `✅ *${headerBlock.text.text}* — You answered: *${payload.label}*`
          }
        ]
      });
      };
      

      // 4. Replace the old question block with the new confirmation block
      originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
    }
    

    // 5. Update the message with the modified blocks
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: originalBlocks
    });
    

    // Save the response to your sheet
    await processAndSaveResponse(userName, payload.question, payload.label, new Date().toISOString());
  }
});

// Listener for the 'Submit Answers' button for checkboxes
app.action('submit_checkbox_answers', async ({ ack, body, client, action }) => {

// ✨ UPDATED: Listener for the 'Submit Answers' button for one or more checkbox questions
app.action('submit_checkbox_answers', async ({ ack, body, client }) => {
    await ack();

    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    const actionBlock = body.message.blocks.find(b => b.type === 'actions' && b.elements[0].type === 'checkboxes');
    if (!actionBlock) return;
    const actionId = actionBlock.elements[0].action_id;
    const selectedOptions = body.state.values[actionBlock.block_id][actionId].selected_options;
    const question = JSON.parse(body.actions[0].value).question;
    if (selectedOptions.length === 0) {
        await client.chat.postEphemeral({ user: body.user.id, channel: body.channel.id, text: "Please select at least one option before submitting." });
        return;
    

    // 1. Get all the blocks from the original survey message
    let originalBlocks = body.message.blocks;
    let somethingWasAnswered = false;
    
    // 2. Find all checkbox questions in the message

    // 2. Find all checkbox questions in the message state
    const checkboxStates = body.state.values;

    for (const blockId in checkboxStates) {
        const actionId = Object.keys(checkboxStates[blockId])[0];
        const blockState = checkboxStates[blockId][actionId];

        if (blockState.type !== 'checkboxes') continue;

        const selectedOptions = blockState.selected_options;
        if (selectedOptions.length === 0) continue;

        somethingWasAnswered = true;
        const answers = selectedOptions.map(opt => JSON.parse(opt.value));
        const answerText = answers.map(a => `"${a.label}"`).join(', ');

        // 3. Find this checkbox block in the original message and replace it
        const blockIndexToReplace = originalBlocks.findIndex(b => b.block_id === blockId);

        if (blockIndexToReplace > -1) {
            const headerBlock = originalBlocks[blockIndexToReplace - 1];
            const headerBlock = originalBlocks[blockIndexToReplace - 1]; // Assumes header is right before
            const confirmationBlock = {
                type: 'context',
                elements: [{
                    type: 'mrkdwn',
                    text: `✅ *${headerBlock.text.text}* — You answered: *${answerText}*`
                }]
            };
            // Replace the header and the question with the confirmation
            originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);

            // Save each answer to your sheet
            for (const answer of answers) {
                await processAndSaveResponse(userName, answer.question, answer.label, new Date().toISOString());
            }
        }
    }
    const answers = selectedOptions.map(opt => JSON.parse(opt.value).label);
    const answerText = answers.map(a => `"${a}"`).join(', ');
    await client.chat.update({ channel: body.channel.id, ts: body.message.ts, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ Thank you, ${userName}! Your responses *${answerText}* have been recorded.` } }] });
    for (const answer of answers) {
        await processAndSaveResponse(userName, question, answer, new Date().toISOString());

    // If no checkboxes were checked at all, send an ephemeral message
    if (!somethingWasAnswered) {
        await client.chat.postEphemeral({
            user: body.user.id,
            channel: body.channel.id,
            text: "Please select at least one option from a checkbox question before submitting."
        });
        return;
    }
    

    // 4. Update the message with all the modified blocks
    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: originalBlocks
    });
});

// =================================================================
// SECTION 5: APP STARTUP
// =================================================================

// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
