const cron = require('node-cron');
const { 
    getAllScheduledSurveys,
    getIncompleteUsers,
    updateLastReminderTimestamp,
} = require('./sheets');

let slackClient;

const sendReminders = async () => {
    console.log(`[${new Date().toISOString()}] Running hourly reminder check...`);
    if (!slackClient) { return; }

    try {
        const scheduledSurveys = await getAllScheduledSurveys();

        for (const survey of scheduledSurveys) {
            const { sheetName, reminderMessage, reminderHours, lastReminder, recipients } = survey;
            if (!recipients || recipients.length === 0) continue;

            const now = Date.now();
            const last = parseInt(lastReminder, 10) || 0;
            const interval = reminderHours * 60 * 60 * 1000;

            if (now < last + interval) { continue; }
            
            console.log(`Sending reminders for survey: ${sheetName}`);
            
            const incompleteRecipients = await getIncompleteUsers(sheetName, recipients);

            for (const recipient of incompleteRecipients) {
                // Only send reminders to users, not channels
                if (!recipient.id.startsWith('U')) continue;

                let personalizedMessage = reminderMessage;
                try {
                    const userInfo = await slackClient.users.info({ user: recipient.id });
                    const firstName = userInfo.user.profile.first_name || userInfo.user.profile.real_name.split(' ')[0];
                    personalizedMessage = reminderMessage.replace(/\[firstName\]/g, firstName);

                    await slackClient.chat.postEphemeral({
                        channel: recipient.id, // Must send to channel for user to see it
                        user: recipient.id,
                        thread_ts: recipient.ts,
                        text: personalizedMessage
                    });
                     console.log(`Sent reminder to ${firstName} for survey ${sheetName}`);
                } catch (e) {
                    console.error(`Error sending reminder to ${recipient.id}:`, e.data || e);
                }
            }
            await updateLastReminderTimestamp(sheetName, now.toString());
        }
    } catch (e) {
        console.error("Fatal error in scheduler:", e);
    }
};

const startScheduler = (client) => {
    slackClient = client;
    // Schedule to run at the top of every hour
    cron.schedule('0 * * * *', sendReminders);
    console.log('✅ Reminder scheduler has been started.');
};

module.exports = { startScheduler };
