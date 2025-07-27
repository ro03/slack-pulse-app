// 1. All require statements should be at the top
const { App, ExpressReceiver } = require('@slack/bolt');
const { saveResponseToSheet } = require('./sheets');

// 2. Configure dotenv for local development
// This check makes sure dotenv only runs on your local computer, not on Render
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// 3. Create a receiver for HTTP mode. The signing secret goes here.
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Optional: Add a custom route for health checks
receiver.app.get('/', (req, res) => {
  res.status(200).send('App is up and running!');
});

// 4. Initialize the app ONCE with the token and the receiver
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

  const values = view.state.values;
  const questionText = values.question_block.question_input.value;
  const optionsText = values.options_block.options_input.value;
  const userIds = values.users_block.users_select.selected_users;

  const options = optionsText.split('\n').filter(opt => opt.trim() !== '');

  const pollBlocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${questionText}*` }
    },
    {
      type: 'actions',
      elements: options.map(label => ({
        type: 'button',
        text: { type: 'plain_text', text: label },
        value: JSON.stringify({ label, question: questionText }),
        action_id: `answer_button_${label.replace(/\s+/g, '_')}` // Make action_id more robust
      }))
    }
  ];

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

// This listener handles the button click responses
app.action(/^answer_button_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  const payload = JSON.parse(action.value);

  const userInfo = await client.users.info({ user: body.user.id });
  const userName = userInfo.user.profile.real_name || userInfo.user.name;

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ Thank you, ${userName}! Your response "*${payload.label}*" has been recorded.`
        }
      }
    ]
  });

  await saveResponseToSheet({
    user: userName,
    question: payload.question,
    answer: payload.label,
    timestamp: new Date().toISOString()
  });
});

// Start your app
(async () => {
  // This line correctly uses the Render port OR falls back to 3000 for local dev
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
