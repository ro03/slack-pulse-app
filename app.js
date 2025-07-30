const { App, ExpressReceiver } = require('@slack/bolt');
const {
 createNewSheet,
 saveOrUpdateResponse,
 checkIfAnswered,
 saveUserGroup,
 getAllUserGroups,
 getGroupMembers,
 getQuestionTextByIndex, // Make sure this is imported
} = require('./sheets');

const processingRequests = new Set();

if (process.env.NODE_ENV !== 'production') {
 require('dotenv').config();
}

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
   blocks.push({ type: 'divider' }, { type: 'header', text: { type: 'plain_text', text: `Question ${i}` } }, { type: 'input', optional: false, block_id: `question_block_${i}`, label: { type: 'plain_text', text: 'Poll Question' }, element: { type: 'plain_text_input', action_id: `question_input_${i}` } }, { type: 'input', optional: true, block_id: `options_block_${i}`, label: { type: 'plain_text', text: 'Answer Options (one per line for Buttons/Dropdown/Checkboxes)' }, element: { type: 'plain_text_input', multiline: true, action_id: `options_input_${i}` } }, {
     type: 'input',
     block_id: `format_block_${i}`,
     label: { type: 'plain_text', text: 'Question Type' },
     element: {
       type: 'static_select',
       action_id: `format_select_${i}`,
       initial_option: { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' },
       options: [
         { text: { type: 'plain_text', text: 'Buttons' }, value: 'buttons' },
         { text: { type: 'plain_text', text: 'Dropdown Menu' }, value: 'dropdown' },
         { text: { type: 'plain_text', text: 'Checkboxes (Multiple Answers)' }, value: 'checkboxes' },
         { text: { type: 'plain_text', text: 'Open Ended' }, value: 'open-ended' },
         { text: { type: 'plain_text', text: 'Agree/Disagree Scale' }, value: 'agree-disagree' },
         { text: { type: 'plain_text', text: '1-to-5 Scale' }, value: '1-to-5' },
         { text: { type: 'plain_text', text: '1-to-10 Scale' }, value: '1-to-10' },
         { text: { type: 'plain_text', text: 'NPS (0-10)' }, value: 'nps' },
       ]
     }
   });
 }
 blocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: '➕ Add Another Question' }, action_id: 'add_question_button', value: `${questionCount}` }] });
 if (userGroups.length > 0) {
   blocks.push({ type: 'input', block_id: 'group_destination_block', optional: true, label: { type: 'plain_text', text: 'OR... Send to a Saved Group' }, element: { type: 'static_select', action_id: 'group_destination_select', placeholder: { type: 'plain_text', text: 'Select a group' }, options: userGroups.map(group => ({ text: { type: 'plain_text', text: group.GroupName }, value: group.GroupName })) } });
 }
 blocks.push({ type: 'input', block_id: 'destinations_block', optional: true, label: { type: 'plain_text', text: 'Send survey to these users or channels' }, element: { type: 'multi_conversations_select', placeholder: { type: 'plain_text', text: 'Select users and/or channels' }, action_id: 'destinations_select', filter: { include: ["public", "private", "im"], exclude_bot_users: true } } });
 return blocks;
};

app.command('/ask', async ({ ack, body, client }) => {
    const allowedUsers = (process.env.ALLOWED_USER_IDS || '').split(',');
    if (process.env.ALLOWED_USER_IDS && !allowedUsers.includes(body.user_id)) {
        await ack();
        await client.chat.postEphemeral({
            user: body.user_id,
            channel: body.channel_id,
            text: "Sorry, you are not authorized to use this command. Please contact the app administrator."
        });
        return;
    }
    
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
           const pollFormat = values[`format_block_${qIndex}`][`format_select_${qIndex}`].selected_option.value;

           if (questionText) {
                let options = [];
                switch (pollFormat) {
                    case '1-to-5': options = ['1', '2', '3', '4', '5']; break;
                    case '1-to-10': options = Array.from({ length: 10 }, (_, i) => (i + 1).toString()); break;
                    case 'agree-disagree': options = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree']; break;
                    case 'nps': options = Array.from({ length: 11 }, (_, i) => i.toString()); break;
                    default:
                        const optionsText = values[`options_block_${qIndex}`][`options_input_${qIndex}`]?.value || '';
                        options = optionsText.split('\n').filter(opt => opt.trim() !== '');
                }
                
                if (['buttons', 'dropdown', 'checkboxes'].includes(pollFormat) && options.length === 0) {
                    continue;
                }
                
               parsedQuestions.push({ questionText, options, pollFormat });
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
           if (allBlocks.length > 0) {
            const fallbackText = introMessage ? `You have a new message: ${introMessage.substring(0, 50)}...` : 'You have a new message!';
            for (const conversationId of conversationIds) {
                try {
                    await client.chat.postMessage({ channel: conversationId, text: fallbackText, blocks: allBlocks, unfurl_links: true, unfurl_media: true });
                } catch (error) { console.error(`Failed to send message-only post to ${conversationId}`, error); }
            }
           }
           return;
       } 
        
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

       for (const [questionIndex, qData] of parsedQuestions.entries()) {
           allBlocks.push({ type: 'header', text: { type: 'plain_text', text: qData.questionText } });
           
           const baseActionId = `poll_response_${Date.now()}_q${questionIndex}`;
           const valuePayload = (label) => JSON.stringify({ sheetName, label, qIndex: questionIndex });

           let responseBlock;
           switch (qData.pollFormat) {
                case 'open-ended':
                    responseBlock = {
                        block_id: `${baseActionId}_block`,
                        type: 'actions',
                        elements: [{
                            type: 'button',
                            text: { type: 'plain_text', text: '✍️ Answer Question' },
                            action_id: `open_ended_answer_modal`,
                            value: JSON.stringify({ sheetName, qIndex: questionIndex })
                        }]
                    };
                    break;
               case 'dropdown':
                   responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'static_select', placeholder: { type: 'plain_text', text: 'Choose an answer' }, action_id: baseActionId, options: qData.options.map(label => ({ text: { type: 'plain_text', text: label }, value: valuePayload(label) })) }] };
                   break;
               case 'checkboxes':
                   responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: [{ type: 'checkboxes', action_id: baseActionId, options: qData.options.map(label => ({ text: { type: 'mrkdwn', text: label }, value: valuePayload(label) })) }] };
                   break;
               case 'buttons':
               case '1-to-5':
               case '1-to-10':
               case 'agree-disagree':
               case 'nps':
               default:
                   responseBlock = { block_id: `${baseActionId}_block`, type: 'actions', elements: qData.options.map((label, optionIndex) => ({ type: 'button', text: { type: 'plain_text', text: label, emoji: true }, value: valuePayload(label), action_id: `${baseActionId}_btn${optionIndex}` })) };
                   break;
           }
           allBlocks.push(responseBlock);
       }
       
       if (parsedQuestions.some(q => q.pollFormat === 'checkboxes')) {
           allBlocks.push({ type: 'divider' }, { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Submit All My Answers' }, style: 'primary', action_id: `submit_checkbox_answers`, value: JSON.stringify({ sheetName }) }] });
       }
       
       for (const conversationId of conversationIds) {
           try {
               await client.chat.postMessage({ channel: conversationId, text: 'You have a new survey to complete!', blocks: allBlocks, unfurl_links: true, unfurl_media: true });
           } catch (error) { console.error(`Failed to send survey to ${conversationId}`, error); }
       }
       
   } catch (error) {
       console.error("Error processing poll submission:", error);
   }
});

app.action('open_ended_answer_modal', async ({ ack, body, client, action }) => {
    await ack();
    try {
        const { sheetName, qIndex } = JSON.parse(action.value);
        const question = await getQuestionTextByIndex(sheetName, qIndex);

        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        const alreadyAnswered = await checkIfAnswered({ sheetName, user: userName, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({
                channel: body.channel.id,
                user: body.user.id,
                text: "You've already answered this question."
            });
            return;
        }

        const metadata = {
            sheetName,
            qIndex,
            channel_id: body.channel.id,
            message_ts: body.message.ts,
            response_block_id: body.actions[0].block_id
        };

        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'open_ended_submission',
                private_metadata: JSON.stringify(metadata),
                title: { type: 'plain_text', text: 'Your Answer' },
                submit: { type: 'plain_text', text: 'Submit' },
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `*Question:*\n>${question}` }
                    },
                    {
                        type: 'input',
                        block_id: 'open_ended_input_block',
                        label: { type: 'plain_text', text: 'Please type your response below:' },
                        element: {
                            type: 'plain_text_input',
                            action_id: 'open_ended_input',
                            multiline: true
                        }
                    }
                ]
            }
        });
    } catch (error) {
        console.error("Error opening open-ended modal:", error);
    }
});

app.view('open_ended_submission', async ({ ack, body, view, client }) => {
    await ack();
    try {
        const metadata = JSON.parse(view.private_metadata);
        const { sheetName, qIndex, channel_id } = metadata;
        const answerText = view.state.values.open_ended_input_block.open_ended_input.value;

        const question = await getQuestionTextByIndex(sheetName, qIndex);
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        await saveOrUpdateResponse({
            sheetName,
            user: userName,
            question,
            answer: answerText,
            timestamp: new Date().toISOString()
        });
        
        await client.chat.postEphemeral({
            channel: channel_id,
            user: body.user.id,
            text: `✅ Thanks! For "*${question}*", we've recorded your answer.`
        });

    } catch (error) {
        console.error("Error saving open-ended response:", error);
        await client.chat.postEphemeral({
            channel: JSON.parse(view.private_metadata).channel_id,
            user: body.user.id,
            text: "Sorry, there was an error submitting your answer."
        });
    }
});

// Other handlers like poll_response, submit_checkbox_answers, etc. go here...
// Make sure to include all of them from your original file.

(async () => {
 await app.start(process.env.PORT || 3000);
 console.log('⚡️ Bolt app is running!');
})();
