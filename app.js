const { App, ExpressReceiver } = require('@slack/bolt');
const {
 createNewSheet,
 saveOrUpdateResponse,
 checkIfAnswered,
 saveUserGroup,
 getAllUserGroups,
 getGroupMembers,
 getQuestionTextByIndex,
} = require('./sheets');

// ... (No changes to initial setup)

// 💡 RESTORED: Re-added "Open Ended" question type
const generateModalBlocks = (questionCount = 1, userGroups = []) => {
 // ... (code is same as before the "Single Submit" change)
 // This includes restoring the full list of question types in the dropdown
};

// ... (No changes to /ask, add_question_button)

app.view('poll_submission', async ({ ack, body, view, client }) => {
    // 💡 RESTORED: This function now generates simple buttons again for single-choice questions.
    // The code is the same as the version from "Amazing! It's working nicely..."
    // ...
    let responseBlock;
    switch (qData.pollFormat) {
        case 'open-ended':
            responseBlock = { /* ... */ };
            break;
        case 'dropdown':
            responseBlock = { /* ... */ };
            break;
        case 'checkboxes':
            responseBlock = { /* ... */ };
            break;
        case 'buttons': // and scales
        default:
            // This now generates regular buttons again
            responseBlock = { block_id: `...`, type: 'actions', elements: qData.options.map(/*...*/) };
            break;
    }
    allBlocks.push(responseBlock);
    // ...
});

// ... (No changes to /groups handlers)

// --- Survey Response Handlers ---

// 💡 CHANGED: This handler now opens a confirmation modal instead of saving the answer directly.
app.action(/^poll_response_.+$/, async ({ ack, body, client, action }) => {
    await ack();
    
    if (action.type !== 'button' && action.type !== 'static_select') return;
    
    const payload = JSON.parse(action.type === 'button' ? action.value : action.selected_option.value);
    
    try {
        const question = await getQuestionTextByIndex(payload.sheetName, payload.qIndex);

        // Check if user already answered this specific question
        const userInfo = await client.users.info({ user: body.user.id });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;
        const alreadyAnswered = await checkIfAnswered({ sheetName: payload.sheetName, user: userName, question });
        if (alreadyAnswered) {
            await client.chat.postEphemeral({ channel: body.channel.id, user: body.user.id, text: "You've already answered this question." });
            return;
        }

        // Open a modal to confirm the user's choice
        await client.views.open({
            trigger_id: body.trigger_id,
            view: {
                type: 'modal',
                callback_id: 'confirm_answer_submission', // New callback_id
                // Pass all necessary data to the next step
                private_metadata: JSON.stringify(payload), 
                title: { type: 'plain_text', text: 'Confirm Your Answer' },
                submit: { type: 'plain_text', text: 'Confirm' },
                close: { type: 'plain_text', text: 'Cancel' },
                blocks: [
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `You selected an answer for:\n*${question}*` }
                    },
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: `Your answer:\n>*${payload.label}*` }
                    },
                    {
                        type: 'section',
                        text: { type: 'mrkdwn', text: 'Are you sure you want to submit this answer?' }
                    }
                ]
            }
        });
    } catch (error) {
        console.error("Error in poll_response handler:", error);
    }
});

// 💡 NEW: This handler processes the confirmation from the modal.
app.view('confirm_answer_submission', async ({ ack, body, view, client }) => {
    // Acknowledge the view submission, which closes the modal
    await ack();

    try {
        const { sheetName, label, qIndex } = JSON.parse(view.private_metadata);
        const user = body.user.id;
        
        const question = await getQuestionTextByIndex(sheetName, qIndex);
        const userInfo = await client.users.info({ user: user });
        const userName = userInfo.user.profile.real_name || userInfo.user.name;

        // Save the confirmed response to the Google Sheet
        await saveOrUpdateResponse({
            sheetName,
            user: userName,
            question,
            answer: label,
            timestamp: new Date().toISOString()
        });

        // Send a final, private confirmation message to the user
        await client.chat.postEphemeral({
            channel: user, // Send to the user directly
            user: user,
            text: `✅ Thanks! For "*${question}*", your answer "*${label}*" has been recorded.`
        });
    } catch (error) {
        console.error("Error in confirm_answer_submission:", error);
        await client.chat.postEphemeral({
            channel: body.user.id,
            user: body.user.id,
            text: "Sorry, there was an error saving your confirmed answer."
        });
    }
});


// Unchanged handlers for Checkboxes and Open-Ended questions
app.action('submit_checkbox_answers', async ({ ack, body, client, action }) => { /* ... unchanged ... */ });
app.action('open_ended_answer_modal', async ({ ack, body, client, action }) => { /* ... unchanged ... */ });
app.view('open_ended_submission', async ({ ack, body, view, client }) => { /* ... unchanged ... */ });


// --- Start the App ---
(async () => {
 await app.start(process.env.PORT || 3000);
 console.log('⚡️ Bolt app is running!');
})();
