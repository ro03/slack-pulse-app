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


// This command opens the poll creation form (modal)
app.command('/ask', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'poll_submission',
        title: {
          type: 'plain_text',
          text: 'Create a New Poll'
        },
        submit: {
          type: 'plain_text',
          text: 'Send Poll'
        },
        blocks: [
          // Block for the Poll Question
          {
            type: 'input',
            block_id: 'question_block',
            label: { type: 'plain_text', text: 'Poll Question' },
            element: { type: 'plain_text_input', action_id: 'question_input' }
          },
          // Block for the Answer Options
          {
            type: 'input',
            block_id: 'options_block',
            label: { type: 'plain_text', text: 'Answer Options (one per line)' },
            element: { type: 'plain_text_input', multiline: true, action_id: 'options_input' }
          },
          // ✨ NEW: Block to choose the poll format
          {
            type: 'input',
            block_id: 'format_block',
            label: { type: 'plain_text', text: 'Poll Format' },
            element: {
              type: 'static_select',
              action_id: 'format_select',
              placeholder: {
                type: 'plain_text',
                text: 'Choose a format'
              },
              initial_option: { // Default to buttons
                text: { type: 'plain_text', text: 'Buttons' },
                value: 'buttons'
              },
              options: [
                {
                  text: { type: 'plain_text', text: 'Buttons' },
                  value: 'buttons'
                },
                {
                  text: { type: 'plain_text', text: 'Dropdown Menu' },
                  value: 'dropdown'
                },
                {
                    text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' },
                    value: 'checkboxes'
                }
              ]
            }
          },
          // Block for selecting users
          {
            type: 'input',
            block_id: 'users_block',
            label: { type: 'plain_text', text: 'Send to these users' },
            element: {
              type: 'multi_users_select',
              placeholder: { type: 'plain_text', text: 'Select users' },
              action_id: 'users_select'
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
  }
});

// This listener handles the submission of the modal form
app.view('poll_submission', async ({ ack, body, view, client }) => {
  await ack();

  // Extract values from the submitted view
  const values = view.state.values;
  const questionText = values.question_block.question_input.value;
  const optionsText = values.options_block.options_input.value;
  const pollFormat = values.format_block.format_select.selected_option.value;
  const userIds = values.users_block.users_select.selected_users;

  const options = optionsText.split('\n').filter(opt => opt.trim() !== '');

  // Base message blocks
  let pollBlocks = [{
    type: 'section',
    text: { type: 'mrkdwn', text: `*${questionText}*` }
  }];

  // ✨ UPDATED: Logic to build blocks based on the selected format
  let responseBlock;
  const actionId = `poll_response_${Date.now()}`; // Unique ID for the action element

  switch (pollFormat) {
    case 'dropdown':
      responseBlock = {
        type: 'actions',
        elements: [{
          type: 'static_select',
          placeholder: { type: 'plain_text', text: 'Choose an answer' },
          action_id: actionId,
          options: options.map(label => ({
            text: { type: 'plain_text', text: label },
            value: JSON.stringify({ label, question: questionText })
          }))
        }]
      };
      break;
    
    case 'checkboxes':
      responseBlock = {
        type: 'actions',
        elements: [{
          type: 'checkboxes',
          action_id: actionId,
          options: options.map(label => ({
            text: { type: 'mrkdwn', text: label },
            value: JSON.stringify({ label, question: questionText })
          }))
        }]
      };
      break;

    case 'buttons':
    default:
      responseBlock = {
        type: 'actions',
        elements: options.map(label => ({
          type: 'button',
          text: { type: 'plain_text', text: label },
          value: JSON.stringify({ label, question: questionText }),
          action_id: `${actionId}_${label.replace(/\s+/g, '_')}` // Action IDs for buttons must be unique per button
        }))
      };
      break;
  }
  
  pollBlocks.push(responseBlock);
  
  // A confirmation button for checkbox submissions
  if (pollFormat === 'checkboxes') {
      pollBlocks.push({
          type: 'actions',
          elements: [{
              type: 'button',
              text: { type: 'plain_text', text: 'Submit Answers'},
              style: 'primary',
              action_id: 'submit_checkbox_answers',
              value: JSON.stringify({ question: questionText })
          }]
      });
  }

  // Send the poll to each selected user
  for (const userId of userIds) {
    try {
      await client.chat.postMessage({
        channel: userId,
        text: `A new question for you: ${questionText}`,
        blocks: pollBlocks
      });
    } catch (error) {
      console.error(`Failed to send DM to ${userId}`, error);
    }
  }
});

// Generic handler to process and save a response
async function processAndSaveResponse(user, question, answer, timestamp) {
  await saveResponseToSheet({ user, question, answer, timestamp });
}

// ✨ UPDATED: A single, robust listener for all poll responses
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  
  // This listener handles buttons and dropdowns, which don't require a separate submit button.
  if (action.type === 'button' || action.type === 'static_select') {
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;

    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Thank you, ${userName}! Your response "*${payload.label}*" has been recorded.`
        }
      }]
    });
    
    await processAndSaveResponse(userName, payload.question, payload.label, new Date().toISOString());
  }
});

// ✨ NEW: Listener for the 'Submit Answers' button for checkboxes
app.action('submit_checkbox_answers', async ({ ack, body, client }) => {
    await ack();

    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    
    // Checkbox state is inside body.state, not the action payload
    const actionBlockId = body.message.blocks.find(b => b.type === 'actions' && b.elements[0].type === 'checkboxes').elements[0].action_id;
    const selectedOptions = body.state.values[body.message.blocks.find(b => b.type === 'actions' && b.elements[0].type === 'checkboxes').block_id][actionId].selected_options;
    const question = JSON.parse(body.actions[0].value).question;
    
    if (selectedOptions.length === 0) {
        // Optionally send an ephemeral message if nothing was selected
        await client.chat.postEphemeral({
            user: body.user.id,
            channel: body.channel.id,
            text: "Please select at least one option before submitting."
        });
        return;
    }

    const answers = selectedOptions.map(opt => JSON.parse(opt.value).label);
    const answerText = answers.map(a => `"${a}"`).join(', ');

    await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        blocks: [{
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `✅ Thank you, ${userName}! Your responses *${answerText}* have been recorded.`
            }
        }]
    });

    // Save each selected answer as a separate row
    for (const answer of answers) {
        await processAndSaveResponse(userName, question, answer, new Date().toISOString());
    }
});


// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
