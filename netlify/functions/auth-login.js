require("dotenv").config();

const { connectLambda } = require("@netlify/blobs");
const { handleAuthLogin } = require("../../src/auth-handlers");

exports.handler = async (event) => {
  try {
    connectLambda(event);
  } catch (error) {
    console.error("Netlify Blobs connection failed:", error);
  }

  return handleAuthLogin(event);
};
