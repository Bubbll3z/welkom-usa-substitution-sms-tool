require("dotenv").config();
const { connectLambda } = require("@netlify/blobs");
const { handleAuthLogin } = require("../../src/auth-handlers");

exports.handler = async (event) => {
  if (event?.blobs) connectLambda(event);
  return handleAuthLogin(event);
};
