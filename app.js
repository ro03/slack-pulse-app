const { App } = require('@slack/bolt');
const express = require('express');
const dotenv = require('dotenv');
const { saveResponseToSheet } = require('./sheets');

dotenv.config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // <-- Add this line
  appToken: process.env.SLACK_APP_TOKEN // <-- And this line
});


const expressApp = express();

// Slash command: /ask
// Upgraded Slash command: /ask
app.command('/ask', async ({ ack, body, client }) => {
  // Acknowledge the command
  await ack();

  try {
    // Call views.open with the trigger_id from the command
    await client.views.open({
      trigger_id: body.trigger_id,
      // The view payload (the form)
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
            label: {
              type: 'plain_text',
              text: 'Poll Question'
            },
            element: {
              type: 'plain_text_input',
              action_id: 'question_input'
            }
          },
          {
            type: 'input',
            block_id: 'options_block',
            label: {
              type: 'plain_text',
              text: 'Answer Options (one per line)'
            },
            element: {
              type: 'plain_text_input',
              multiline: true,
              action_id: 'options_input'
            }
          },
          {
            type: 'input',
            block_id: 'users_block',
            label: {
              type: 'plain_text',
              text: 'Send to these users'
            },
            element: {
              type: 'multi_users_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select users'
              },
              action_id: 'users_select'
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
    await client.chat.postMessage({
        channel: command.user_id,
        text: `Error: Could not send poll. Make sure the app is a member of this channel. (${error.data.error})`
    });
  }
});

// Handle button response
// NEW AND IMPROVED ACTION HANDLER
// UPDATED ACTION HANDLER WITH USER NAME LOOKUP
app.action(/^answer_button_.+$/, async ({ ack, body, client, action }) => {
  // Acknowledge the button click
  await ack();

  const payload = JSON.parse(action.value);

  // Get user's profile information from Slack
  const userInfo = await client.users.info({
    user: body.user.id
  });
  const userName = userInfo.user.profile.real_name || userInfo.user.name;

  // Update the original message with confirmation
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

  // This listener handles the submission of the modal form
app.view('poll_submission', async ({ ack, body, view, client }) => {
  // Acknowledge the view submission
  await ack();

  // Extract the data from the form's state
  const values = view.state.values;
  const questionText = values.question_block.question_input.value;
  const optionsText = values.options_block.options_input.value;
  const userIds = values.users_block.users_select.selected_users;

  // Split the multi-line options text into an array
  const options = optionsText.split('\n').filter(opt => opt.trim() !== '');

  // The poll message blocks (same as before)
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

  // Loop through the selected user IDs and send them the poll DM
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

  // Save the response to Google Sheets with the real name
  await saveResponseToSheet({
    user: userName, // <-- This now uses the user's real name
    question: payload.question,
    answer: payload.label,
    timestamp: new Date().toISOString()
  });
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡ Slack app is running!');
})();

// A simple test to see if the app is connected and receiving events
app.event('app_home_opened', async ({ event, client }) => {
  console.log(`✅ Connection test successful! User ${event.user} opened the app's Home tab.`);
});