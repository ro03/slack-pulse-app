const { App, ExpressReceiver } = require("@slack/bolt");


// 1. Explicitly create an ExpressReceiver
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// 2. Create the Bolt App, passing the custom receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver,
});

// 3. Add the health check route directly to the receiver
receiver.app.get('/', (req, res) => {
  res.status(200).send('App is running!');
});

// This check makes sure dotenv only runs on your local computer, not on Render
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const { App, ExpressReceiver } = require("@slack/bolt");
const { saveResponseToSheet } = require('./sheets');

// Initialize the app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  //socketMode: true,
  //appToken: process.env.SLACK_APP_TOKEN
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
          {
            type: 'input',
            block_id: 'question_block',
            label: { type: 'plain_text', text: 'Poll Question' },
            element: { type: 'plain_text_input', action_id: 'question_input' }
          },
          {
            type: 'input',
            block_id: 'options_block',
            label: { type: 'plain_text', text: 'Answer Options (one per line)' },
            element: { type: 'plain_text_input', multiline: true, action_id: 'options_input' }
          },
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
        action_id: `answer_button_${label}`
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

// Respond to health checks from Render
app.receiver.app.get('/', (req, res) => {
  res.status(200).send('App is running!');
});

// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Slack app is running!');
})();
