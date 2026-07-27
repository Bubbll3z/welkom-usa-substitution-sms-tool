require("dotenv").config();
const { connectLambda } = require("@netlify/blobs");
const { handleAdminListUsers } = require("../../src/auth-handlers");

exports.handler = async (event) => {
  if (event?.blobs) connectLambda(event);
  return handleAdminListUsers(event);
};
