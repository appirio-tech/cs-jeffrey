
/**
 * Module dependencies.
 */
var config = require('./config.js');
var express = require('express')
  , faye    = require('faye')
  , nforce = require('nforce')
  , util = require('util')
  , routes = require('./routes');

var app = module.exports = express.createServer();

// attach socket.io and listen 
var io = require('socket.io').listen(app);
// get a reference to the socket once a client connects
var socket = io.sockets.on('connection', function (socket) { }); 

// Bayeux server - mounted at /cometd
var fayeServer = new faye.NodeAdapter({mount: '/cometd', timeout: 60 });
fayeServer.attach(app);

var cloudSpokesOrg = nforce.createConnection({
  clientId: config.CS_CLIENT_ID,
  clientSecret: config.CS_CLIENT_SECRET,
  redirectUri: config.CALLBACK_URL + '/oauth/_callback',
  apiVersion: 'v24.0',  // optional, defaults to v24.0
  environment: config.ENVIRONMENT  // optional, sandbox or production, production default
});

var cmcOrg = nforce.createConnection({
  clientId: config.CMC_CLIENT_ID,
  clientSecret: config.CMC_CLIENT_SECRET,
  redirectUri: config.CALLBACK_URL + '/oauth/_callback',
  apiVersion: 'v24.0',  // optional, defaults to v24.0
  environment: config.ENVIRONMENT  // optional, sandbox or production, production default
});

// Configuration
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'jade');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public')); 
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes
app.get('/', routes.index);

app.listen(config.PORT, function(){
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

// updates CMC org with status and submission count
function updateCmcOrg(challenge) {

  cmcOrg.authenticate({ username: config.CMC_USERNAME, password: config.CMC_PASSWORD }, function(err, resp){
    if(err) {
      console.log('[ERROR]Error authenticating to Appirio Production Org: ' + err.message);
    } else {
      console.log('[INFO]Successfully logged into the Appirio Production Org.');
      // update the cmc task with the status and submissions
      var obj = nforce.createSObject('CMC_Task__c', { 
          Id: challenge['sobject']['CMC_Task__c'], 
          CloudSpokes_Task_Status__c: challenge['sobject']['Status__c'],
          CloudSpokes_Submission_Count__c: challenge['sobject']['Submissions__c'],
          CloudSpokes_Challenge_Name__c: challenge['sobject']['Name']
        });
      cmcOrg.update(obj, resp, function(results) {
        console.log('[INFO]Updating CMC Task the Appirio Production Org...');
        if(results) console.log('[INFO]' + results);
        if(err) console.log('[FATAL]' + err.message); 
        // emit the message that the record has been updated
        socket.emit('record-processed', { msg: 'CMC Task ' + challenge['sobject']['CMC_Task__c'] + 
          ' updated with status of ' + challenge['sobject']['Status__c'] + ' and ' + 
          challenge['sobject']['Submissions__c'] + ' submissions.' }); 
      });  
    }
  });  

}

// update the cloudspokes org with the project number from cmc org
function updateCloudSpokesOrg(challenge) {

  // fetch the project number from CMC -- callbck passes in projectId
  getCmcProjectNumber(challenge, function(projectId) {
    cloudSpokesOrg.authenticate({ username: config.CS_USERNAME, password: config.CS_PASSWORD }, function(err, resp){
      if(err) {
        console.log('[FATAL]Error authenticating to CloudSpokes org: ' + err.message);
      } else {
        // update the challenge with the projectid
        var obj = nforce.createSObject('Challenge__c', { 
            Id: challenge['sobject']['Challenge__c'], 
            Reference_Number__c: projectId
          });
        cloudSpokesOrg.update(obj, resp, function(results) {
          console.log('[INFO]Updating Challenge in CloudSpokes Org');
          if(results) console.log('[INFO]' + results);
          if(err) console.log('[FATAL]' + err.message); 
          socket.emit('record-processed', { msg: 'CloudSpokes challenge ' + 
            challenge['sobject']['Challenge__c'] + ' updated with Reference Nubmer ' + 
            projectId + '.' }); 
        });  
      }
    });    

  });

}

// queries for the project id for a task and returns it
function getCmcProjectNumber(challenge, callback) {

  cmcOrg.authenticate({ username: config.CMC_USERNAME, password: config.CMC_PASSWORD }, function(err, resp){
    if(err) {
      console.log('[FATAL]Error authenticating to Appirio Production Org: ' + err.message);
    } else {
      console.log('[INFO]Successfully logged into the Appirio Production Org.');
      cmcOrg.query("select Id, Story__r.Sprint__r.Release__r.Project__r.pse__Project_ID__c from CMC_Task__c where id = '"+challenge['sobject']['CMC_Task__c']+"'", resp, function(err, resp){
        console.log('[INFO]Querying the Appirio Production Org.');
        try {
          var projectId = resp.records[0]['Story__r']['Sprint__r']['Release__r']['Project__r']['pse__Project_ID__c'];  
          if(config.DEBUG) console.log('[INFO]Found projectId: '+projectId);
          callback(projectId);
        } catch (e) {
          socket.emit('record-processed', { msg: 'Could not find a ProjectId for task '+ challenge['sobject']['CMC_Task__c'] + ' for challenge ' + challenge['sobject']['Id'] }); 
        }
      });
    }
  }); 

}

// authenticates and returns OAuth -- used by faye
function getCloudSpokesOAuthToken(callback) {

  if(config.DEBUG) console.log("[INFO]Authenticating to get CloudSpoke salesforce.com access token...");
  
  cloudSpokesOrg.authenticate({ username: config.CS_USERNAME, password: config.CS_PASSWORD }, function(err, resp){
    if(err) {
      console.log('[ERROR]Error authenticating to CloudSpokes org: ' + err.message);
    } else {
      if(config.DEBUG) console.log('[INFO]OAauth dance response: ' + util.inspect(resp));
      callback(resp);
    }
  });

}

// get the access token from salesforce.com to start the entire polling process
getCloudSpokesOAuthToken(function(oauth) { 

  // cometd endpoint
  var salesforce_endpoint = oauth.instance_url +'/cometd/24.0';
  if(config.DEBUG) console.log("[INFO]Creating a client for "+ salesforce_endpoint);

  // add the client listening to salesforce.com
  var client = new faye.Client(salesforce_endpoint);

  // set header with OAuth token
  client.setHeader('Authorization', 'OAuth '+ oauth.access_token);

  // monitor connection down and reset the header
  client.bind('transport:down', function(client) {
    // get an OAuth token again
    getCloudSpokesOAuthToken(function(oauth) {
      // set header again
      upstreamClient.setHeader('Authorization', 'OAuth '+ oauth.access_token);
    });
  });

  // subscribe to salesforce.com push topic
  if(config.DEBUG) console.log('[INFO]Subscribing to '+ config.PUSH_TOPIC);
  var upstreamSub = client.subscribe(config.PUSH_TOPIC, function(message) {
    // new inserted/updated record receeived -- do something with it
    if(config.DEBUG) console.log("[INFO]Received upstream message: " + JSON.stringify(message)); 
    updateCmcOrg(message); 
    updateCloudSpokesOrg(message);
  });

  // log that upstream subscription is active
  client.callback(function() {
    if(config.DEBUG) console.log('[INFO]Upstream subscription is now active');    
  });

  // log that upstream subscription encounters error
  client.errback(function(error) {
    if(config.DEBUG) console.error("[ERROR]ERROR ON Upstream subscription Attempt: " + error.message);
  });

  /**
  // just for debugging I/O, an extension to client
  client.addExtension({
    outgoing: function(message, callback) {   
      if(config.DEBUG) console.log('OUT >>> '+ JSON.stringify(message));
      callback(message);            
    },
    incoming: function(message, callback) {   
      if(config.DEBUG) console.log('IN >>>> '+ JSON.stringify(message));
      callback(message);            
    }            
  });  
  **/
  
});
