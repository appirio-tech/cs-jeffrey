exports.PORT = process.env.PORT || 3001; // use heroku's dynamic port or 3001 if localhost
exports.DEBUG = process.env.DEBUG; 
exports.ENVIRONMENT = process.env.ENVIRONMENT; 
exports.CALLBACK_URL = process.env.CALLBACK_URL; 
exports.PUSH_TOPIC = '/topic/CMC_Challenges';

exports.CMC_CLIENT_ID = process.env.CMC_CLIENT_ID;
exports.CMC_CLIENT_SECRET = process.env.CMC_CLIENT_SECRET;
exports.CMC_USERNAME = process.env.CMC_USERNAME;
exports.CMC_PASSWORD = process.env.CMC_PASSWORD;

exports.CS_CLIENT_ID = process.env.CS_CLIENT_ID;
exports.CS_CLIENT_SECRET = process.env.CS_CLIENT_SECRET;
exports.CS_USERNAME = process.env.CS_USERNAME;
exports.CS_PASSWORD = process.env.CS_PASSWORD;