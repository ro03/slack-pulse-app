// 1. All require statements should be at the top
const { App, ExpressReceiver } = require('@slack/bolt');
const cron = require('node-cron');
const {
  getIncompleteCandidatesCount,
  getCandidateStatus,
  getHygieneStatus,
  getRandomTip,
  getLeaderboard
} = require('./dataSource');

// NOTE: require('./sheets') has been removed from here to prevent slow startup times.

// 2. Configure dotenv for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

// --- ✨ NEW: Configuration ---
// IMPORTANT: Replace this with the actual channel ID you want to post in.
const HYGIENE_CHANNEL_ID = 'C12345ABCDE'; 
const ATS_CANDIDATES_URL = 'https://youra-ts.com/candidates?filter=missing-notes'; // Optional: Link for the reminder button


// 3. Create a receiver for HTTP mode
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

receiver.app.get('/', (req, res) => {
  res.status(200).send('App is up and running!');
});


// 4. Initialize the app ONCE
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: receiver,
});


// --- FEATURE 2: Polls & Pulse Checks (Existing Code) ---
const generateModalBlocks = (questionCount = 1) => {
  let blocks = [];
  blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Survey Introduction (Optional)' } }, { type: 'input', block_id: 'intro_message_block', optional: true, label: { type: 'plain_text', text: 'Introductory Message' }, element: { type: 'plain_text_input', multiline: true, action_id: 'intro_message_input' } }, { type: 'input', block_id: 'image_url_block', optional: true, label: { type: 'plain_text', text: 'Image or GIF URL' }, element: { type: 'plain_text_input', action_id: 'image_url_input', placeholder: { type: 'plain_text', text: 'https://example.com/image.gif' } } }, { type: 'input', block_id: 'video_url_block', optional: true, label: { type: 'plain_text', text: 'YouTube or Vimeo Video URL' }, element: { type: 'plain_text_input', action_id: 'video_url_input', placeholder: { type: 'plain_text', text: 'https://www.youtube.com/watch?v=...' } } });
  for (let i = 1; i <= questionCount; i++) {
    blocks.push({ type: 'divider' }, { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } }, { type: 'input', block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } }, { type: 'input', block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } }, { type: 'input', block_id: `format_block_${i}`, label: { type: 'plain_text', text: 'Poll Format' }, element: { type: 'static_select', action_id: `format_select_${i}`, initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, options: [ { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' }, { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' }, { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' } ] } });
  }
  blocks.push({ type: 'divider' }, { type: 'actions', elements: [ { type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` } ] });
  blocks.push({ type: 'input', block_id: 'users_block', label: { type: 'plain_text', text: 'Send survey to these users' }, element: { type: 'multi_users_select', placeholder: { type: 'plain_text', text: 'Select users' }, action_id: 'users_select' } });
  return blocks;
};

app.command('/ask', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({ trigger_id: body.trigger_id, view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(1) } });
  } catch (error) { console.error(error); }
});

app.action('add_question_button', async ({ ack, body, client, action }) => {
  await ack();
  const newQuestionCount = parseInt(action.value, 10) + 1;
  try {
    await client.views.update({ view_id: body.view.id, hash: body.view.hash, view: { type: 'modal', callback_id: 'poll_submission', title: { type: 'plain_text', text: 'Create a New Survey' }, submit: { type: 'plain_text', text: 'Send Survey' }, blocks: generateModalBlocks(newQuestionCount) } });
  } catch (error) { console.error("Failed to update view:", error); }
});

app.view('poll_submission', async ({ ack, body, view, client }) => {
  await ack();
  const values = view.state.values;
  const userIds = values.users_block.users_select.selected_users;
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
    if (questionText && optionsText) { parsedQuestions.push({ questionText, options: optionsText.split('\n').filter(opt => opt.trim() !== ''), pollFormat }); }
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
      default:
        responseBlock = { type: 'actions', elements: questionData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label }, value: JSON.stringify({ label, question: questionData.questionText }), action_id: `${baseActionId}_btn${optionIndex}` })) };
        break;
    }
    allBlocks.push(responseBlock);
  }
  if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) { allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers'}, style: 'primary', action_id: 'submit_checkbox_answers' }] }); }
  for (const userId of userIds) {
    try {
      await client.chat.postMessage({ channel: userId, text: 'You have a new survey to complete!', blocks: allBlocks, unfurl_links: true, unfurl_media: true });
    } catch (error) { console.error(`Failed to send survey DM to ${userId}`, error); }
  }
});

// CORRECTED: This helper function is now standalone and "lazy loads" the sheets module.
async function processAndSaveResponse(user, question, answer, timestamp) {
  // LAZY LOAD: Require the module right before you use it to avoid startup timeouts.
  const { saveResponseToSheet } = require('./sheets');
  await saveResponseToSheet({ user, question, answer, timestamp });
}

app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
  await ack();
  if (action.type === 'button' || action.type === 'static_select') {
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    const originalBlocks = body.message.blocks;
    const actionBlockId = body.actions[0].block_id;
    const blockIndexToReplace = originalBlocks.findIndex(block => block.block_id === actionBlockId);
    if (blockIndexToReplace > -1) {
      const headerBlock = originalBlocks[blockIndexToReplace - 1];
      const confirmationBlock = { type: 'context', elements: [ { type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${payload.label}*` } ] };
      originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
    }
    await client.chat.update({ channel: body.channel.id, ts: body.message.ts, blocks: originalBlocks });
    await processAndSaveResponse(userName, payload.question, payload.label, new Date().toISOString());
  }
});

app.action('submit_checkbox_answers', async ({ ack, body, client }) => {
    await ack();
    const userInfo = await client.users.info({ user: body.user.id });
    const userName = userInfo.user.profile.real_name || userInfo.user.name;
    let originalBlocks = body.message.blocks;
    let somethingWasAnswered = false;
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
        const blockIndexToReplace = originalBlocks.findIndex(b => b.block_id === blockId);
        if (blockIndexToReplace > -1) {
            const headerBlock = originalBlocks[blockIndexToReplace - 1];
            const confirmationBlock = { type: 'context', elements: [{ type: 'mrkdwn', text: `✅ *${headerBlock.text.text}* — You answered: *${answerText}*` }] };
            originalBlocks.splice(blockIndexToReplace - 1, 2, confirmationBlock);
            for (const answer of answers) { await processAndSaveResponse(userName, answer.question, answer.label, new Date().toISOString()); }
        }
    }
    if (!somethingWasAnswered) {
        await client.chat.postEphemeral({ user: body.user.id, channel: body.channel.id, text: "Please select at least one option from a checkbox question before submitting." });
        return;
    }
    await client.chat.update({ channel: body.channel.id, ts: body.message.ts, blocks: originalBlocks });
});

// --- ✨ FEATURE 3: Slash Commands ---

app.command('/check-candidate', async ({ command, ack, respond }) => {
  await ack();
  const candidateName = command.text;
  if (!candidateName) {
    await respond({ text: 'Please provide a candidate name. Usage: `/check-candidate [name]`', response_type: 'ephemeral' });
    return;
  }
  const statusMessage = await getCandidateStatus(candidateName);
  await respond({ text: statusMessage, response_type: 'ephemeral' });
});

app.command('/data-hygiene-status', async ({ ack, respond }) => {
  await ack();
  const status = await getHygieneStatus();
  await respond({
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Current Data Hygiene Status' } },
      { type: 'section', text: { type: 'mrkdwn', text: `- *Stale Candidates*: ${status.stale}\n- *Missing Notes*: ${status.missingNotes}\n- *Potential Duplicates*: ${status.duplicates}` } }
    ],
    response_type: 'ephemeral'
  });
});

app.command('/hygiene-tip', async ({ ack, respond }) => {
  await ack();
  const tip = getRandomTip();
  await respond({
    text: `💡 Tip: ${tip}`,
    response_type: 'in_channel'
  });
});

// --- ✨ FEATURE 7: Quick Feedback Flow ---

app.command('/send-feedback', async ({ ack, client, channel_id }) => {
  await ack();
  try {
    await client.chat.postMessage({
      channel: channel_id,
      text: 'Got feedback on our data hygiene process?',
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: '💬 Got feedback on the data hygiene process or this bot?' }
      }, {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Send Feedback' }, action_id: 'open_feedback_modal' }]
      }]
    });
  } catch (error) {
    console.error(error);
  }
});

app.action('open_feedback_modal', async ({ ack, body, client }) => {
  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'feedback_submission',
        title: { type: 'plain_text', text: 'Submit Feedback' },
        submit: { type: 'plain_text', text: 'Submit' },
        blocks: [{
          type: 'input',
          block_id: 'feedback_block',
          label: { type: 'plain_text', text: 'Your comments' },
          element: { type: 'plain_text_input', multiline: true, action_id: 'feedback_input' }
        }]
      }
    });
  } catch (error) {
    console.error(error);
  }
});

app.view('feedback_submission', async ({ ack, view, client, body }) => {
  await ack();
  const feedbackText = view.state.values.feedback_block.feedback_input.value;
  const user = body.user.id;

  console.log(`Feedback from <@${user}>: ${feedbackText}`);
  
  try {
    await client.chat.postMessage({
      channel: user,
      // CORRECTED: Switched to double quotes to handle the apostrophe
      text: "Thank you for your feedback! We've received it. 🙏"
    });
  } catch (error) {
    console.error(error);
  }
});


// --- ✨ FEATURES 1, 4, 5, 6: Scheduled Posts ---

// Schedule format: [minute] [hour] [day of month] [month] [day of week]
cron.schedule('0 9 * * 1', async () => {
  try {
    const status = await getHygieneStatus();
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: HYGIENE_CHANNEL_ID,
      text: 'Weekly Data Hygiene Report',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '📊 Weekly Data Hygiene Report' } },
        { type: 'section', text: { type: 'mrkdwn', text: `Here's our status for the week:\n• *${status.missingNotes}* candidates with missing notes\n• *${status.stale}* overdue feedbacks\n• *${status.duplicates}* potential duplicates` } },
        { type: 'section', text: { type: 'mrkdwn', text: "Let's aim for 0 by Friday! 🚀" } }
      ]
    });
    console.log('✅ Weekly hygiene report posted.');
  } catch (error) {
    console.error('❌ Failed to post weekly report:', error);
  }
}, {
  timezone: "Europe/Warsaw" // Set to your team's timezone
});

cron.schedule('0 10 * * 3', async () => {
  try {
    const tip = getRandomTip();
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: HYGIENE_CHANNEL_ID,
      text: `💡 Tip of the Week: ${tip}`
    });
    console.log('✅ Tip of the week posted.');
  } catch (error) {
    console.error('❌ Failed to post tip:', error);
  }
}, {
  timezone: "Europe/Warsaw"
});

cron.schedule('0 14 * * 5', async () => {
  try {
    const count = await getIncompleteCandidatesCount();
    const reminderBlocks = [
      { type: 'section', text: { type: 'mrkdwn', text: `🧹 *Reminder*: You have *${count} candidates* without recent notes. Let’s keep our data clean!` } }
    ];
    if (ATS_CANDIDATES_URL) {
      reminderBlocks.push({
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Candidates' }, url: ATS_CANDIDATES_URL }]
      });
    }

    const leaderboard = await getLeaderboard();
    const leaderboardText = leaderboard
      .map((user, index) => `${index + 1}. <@${user.userId}> – ${user.score} updates`)
      .join('\n');
    
    const combinedBlocks = [
      ...reminderBlocks,
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: '🏆 Top Hygiene Heroes This Week' } },
      { type: 'section', text: { type: 'mrkdwn', text: leaderboardText } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Thanks for keeping our data clean!' }] }
    ];
    
    await app.client.chat.postMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: HYGIENE_CHANNEL_ID,
      text: 'Weekly Hygiene Reminder and Leaderboard',
      blocks: combinedBlocks
    });
    console.log('✅ Friday reminder and leaderboard posted.');
  } catch (error) {
    console.error('❌ Failed to post Friday message:', error);
  }
}, {
  timezone: "Europe/Warsaw"
});


// Start your app
(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ Bolt app is running!');
})();
