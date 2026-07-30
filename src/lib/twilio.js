const { sendSms, validateTwilioSignature } = require("../sms");

async function sendSMS({ to, body, from }) {
  return sendSms({ phone: to, message: body, orderName: "", env: { ...process.env, TWILIO_FROM_NUMBER: from || process.env.TWILIO_FROM_NUMBER } });
}

async function sendSubstitutionSMS(options) {
  return sendSMS(options);
}

async function sendCustomSMS(options) {
  return sendSMS(options);
}

module.exports = {
  sendCustomSMS,
  sendSMS,
  sendSubstitutionSMS,
  validateTwilioSignature
};
