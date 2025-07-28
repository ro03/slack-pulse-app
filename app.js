// 1. All require statements should be at the top
const { App, ExpressReceiver } = require('@slack/bolt');
const { saveResponseToSheet } = require('./sheets');
const { getMainMenuBlocks, getPollCreationBlocks } = require('./views'); // We'll define these later

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


// =================================================================
// ✨ SECTION 1: VIEW DEFINITIONS
// For better organization, we define the modal blocks in functions.
// =================================================================

/**
 * Gets the blocks for the initial main menu.
 */
const getMainMenuBlocks = () => {
  return [
    {
      "type": "header",
      "text": {
        "type": "plain_text",
        "text": "Create a new poll"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "What would you like to create?"
      }
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
    blocks.push(
      { type: 'divider' },
      { type: 'input', block_id: 'channel_block', label: { type: 'plain_text', text: 'Post survey in this channel' }, element: { type: 'conversations_select', placeholder: { type: 'plain_text', text: 'Select a channel' }, action_id: 'channel_select', filter: { "include": [ "public" ] } } }
    );

    return blocks;
};


// =================================================================
// ✨ SECTION 2: APP LISTENERS (COMMANDS AND ACTIONS)
// This is where the app responds to user interactions.
// =================================================================

// --- Step 1: User types /ask, opening the Main Menu ---
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

    if (newQuestion && newOptions) {
        metadata.questions.push({
            questionText: newQuestion,
            options: newOptions.split('\n').filter(opt => opt.trim() !== ''),
            pollFormat: 'buttons' // Hard-coded for this example
        });
    }
    
    // Also save the intro message if it has been typed
    metadata.intro_message = values.intro_message_block.intro_message_input.value || '';

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
});


// =================================================================
// ✨ SECTION 3: FINAL SUBMISSION HANDLING
// =================================================================

app.view('poll_submission', async ({ ack, body, view, client }) => {
  // Acknowledge the view submission immediately
  await ack();

  const values = view.state.values;
  
  // Get the final state from the metadata
  const metadata = JSON.parse(view.private_metadata);
  const introMessage = values.intro_message_block.intro_message_input.value;
  const parsedQuestions = metadata.questions;

  // This will hold ALL blocks for the final survey message
  let allBlocks = [];

  if (introMessage) {
    allBlocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: introMessage }
    });
    allBlocks.push({ type: 'divider' });
  }

  // Loop through the questions stored in metadata to build the message
  for (const [questionIndex, questionData] of parsedQuestions.entries()) {
    allBlocks.push({
        type: 'header',
        text: { type: 'plain_text', text: questionData.questionText }
    });
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
    allBlocks.push(responseBlock);
  }

  if (allBlocks.length === 0) {
    // Handle case where user submits without adding any questions
    console.log("User submitted an empty survey.");
    return;
  }
  
  // Get the selected channel and post the survey
  const selectedChannel = values.channel_block.channel_select.selected_conversation;
  if (selectedChannel) {
    try {
      await client.chat.postMessage({
        channel: selectedChannel,
        text: 'A new survey has been posted!',
        blocks: allBlocks,
      });
    } catch (error) {
      console.error(`Failed to post survey to channel ${selectedChannel}`, error);
    }
  }
});


// =================================================================
// ✨ SECTION 4: RESPONSE HANDLING (No changes needed here)
// =================================================================

// Generic handler to process and save a response
async function processAndSaveResponse(user, question, answer, timestamp) {
  await saveResponseToSheet({ user, question, answer, timestamp });
}

// Listener for button clicks on a poll
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  if (action.type === 'button') {
    const payload = JSON.parse(action.value);
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    const originalBlocks = body.message.blocks;
    const actionBlockId = body.actions[0].block_id;
    const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);

    if (blockIndexToReplace > -1) {
      const headerBlock = originalBlocks[blockIndexToReplace - 1];
      originalBlocks.splice(blockIndexToReplace - 1, 2, {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `✅ *${headerBlock.text.text}* — You answered: *${payload.label}*`
          }
        ]
      });
    }

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: originalBlocks
    });

    await processAndSaveResponse(userName, payload.question, payload.label, new Date().toISOString());
  }
});


// =================================================================
// ✨ SECTION 5: APP STARTUP
// =================================================================

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
