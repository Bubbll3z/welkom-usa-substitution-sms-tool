const { redactPhone } = require("../sms");

function maskPhone(phone) {
  return redactPhone(phone);
}

module.exports = {
  maskPhone
};
