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
            
            const enrichedRecipients = [];
            for (const r of recipients) {
                if(r.id.startsWith('U')) {
                    try {
                        const userInfo = await slackClient.users.info({ user: r.id });
                        enrichedRecipients.push({ ...r, name: userInfo.user.profile.real_name || userInfo.user.name });
                    } catch (e) { console.error(`Could not enrich user ${r.id}`) }
                } else {
                    enrichedRecipients.push(r);
                }
            }
            const incompleteRecipients = await getIncompleteUsers(sheetName, enrichedRecipients);
            for (const recipient of incompleteRecipients) {
                if (!recipient.id.startsWith('U')) continue;
                let personalizedMessage = reminderMessage || 'Hi [firstName], just a friendly reminder to complete this survey.';
                try {
                    const firstName = recipient.name.split(' ')[0];
                    personalizedMessage = personalizedMessage.replace(/\[firstName\]/g, firstName);
                    await slackClient.chat.postEphemeral({
                        channel: recipient.id,
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
    cron.schedule('0 * * * *', sendReminders);
    console.log('✅ Reminder scheduler has been started.');
};

module.exports = { startScheduler };
