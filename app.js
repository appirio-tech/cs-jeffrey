var express = require('express')
  , nforce = require('nforce');

var port = process.env.PORT || 5001; // use heroku's dynamic port or 5001 if localhost

var csOrg = nforce.createConnection({
  clientId: process.env.CS_CLIENT_ID,
  clientSecret: process.env.CS_CLIENT_SECRET,
  redirectUri: process.env.CALLBACK_URL + '/oauth/_callback',  
  environment: process.env.SFDC_ENVIRONMENT,
  mode: 'single' 
});

var cmcOrg = nforce.createConnection({ 
  clientId: process.env.CMC_CLIENT_ID,
  clientSecret: process.env.CMC_CLIENT_SECRET,
  redirectUri: process.env.CALLBACK_URL + '/oauth/_callback',  
  environment: process.env.SFDC_ENVIRONMENT,
  mode: 'single' 
});

// authenticate and start listening for events from CS org
csOrg.authenticate({ username: process.env.CS_USERNAME, password: process.env.CS_PASSWORD}, function(err, resp){
  if (!err) {
    console.log('[INFO]Successfully logged into the CS org.');
    console.log('[INFO]Trying to connect to ' + process.env.PUSH_TOPIC + ' channel...');

    // subscribe to a pushtopic
    var streamer = csOrg.stream(process.env.PUSH_TOPIC);

    streamer.on('connect', function(){
      console.log('[INFO]CONNECTED!! Listening for new messages from the CS org on ' + process.env.PUSH_TOPIC + '....');
    });

    streamer.on('data', function(data) {
      console.log('[INFO]Received the following message from the CS org:');
      console.log(JSON.stringify(data));
      updateCmcOrg(data); 
      updateCloudSpokesOrg(data);      
    });

    streamer.on('error', function(error) {
      console.log('[FATAL]Error with Stream from CS org: ' + error);
    });    

    streamer.on('disconnect', function() {
      console.log('[FATAL]Disconnected from the CS org.');
    });        

  } else {
    console.log('[FATAL]Error authenticating to CS org: ' + err.message);
  }
});

// create the server
var app = express();

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

app.get('/', function(req, res){
  res.send('cs-jeffrey');
});

// updates CMC org with status and submission count
function updateCmcOrg(challenge) {

  cmcOrg.authenticate({ username: process.env.CMC_USERNAME, password: process.env.CMC_PASSWORD }, function(err, resp){
    if(err) {
      console.log('[FATAL]Error authenticating to CMC org to update Task: ' + err.message);
    } else {
      console.log('[INFO]Successfully logged into the CMC org. Updating CMC task...');
      // update the cmc task with the status and submissions
      var obj = nforce.createSObject('CMC_Task__c', { 
          Id: challenge['sobject']['CMC_Task__c'], 
          CloudSpokes_Task_Status__c: challenge['sobject']['Status__c'],
          CloudSpokes_Submission_Count__c: challenge['sobject']['Submissions__c'],
          CloudSpokes_Challenge_Name__c: challenge['sobject']['Challenge_Name__c'],
          CloudSpokes_Challenge_Start_Date__c: challenge['sobject']['Challenge_Start_Date__c'],
          CloudSpokes_Challenge_End_Date__c: challenge['sobject']['Challenge_End_Date__c'],
          CloudSpokesContest__c: challenge['sobject']['Challenge_URL__c'],
          CloudSpokesContestId__c: challenge['sobject']['Challenge_Id__c']
        });
      cmcOrg.update(obj, function(err, resp) {
        if (!err) console.log('[INFO]Task successfully updated!');
        if (err) console.log('[FATAL]' + err.message); 
      });  
    }
  });  

}

// update the cloudspokes org with the project number from cmc org
function updateCloudSpokesOrg(challenge) {

  // fetch the project number from CMC -- callbck passes in projectId
  getCmcProjectNumber(challenge, function(projectId) {
      console.log('[INFO]Updating CS org with Project ID: ' + projectId + '...');
      // update the challenge with the projectid
      var obj = nforce.createSObject('Challenge__c', { 
          Id: challenge['sobject']['Challenge__c'], 
          Reference_Number__c: projectId});
      csOrg.update(obj, function(err, results) {
        if (!err) console.log('[INFO]Challenge successfully updated!');
        if (err) console.log('[FATAL]' + err.message); 
      });    
  });

}

// queries for the project id for a task and returns it
function getCmcProjectNumber(challenge, callback) {

  cmcOrg.authenticate({ username: process.env.CMC_USERNAME, password: process.env.CMC_PASSWORD }, function(err, resp){
    if(err) {
      console.log('[FATAL]Error authenticating to CMC org to get Project ID: ' + err.message);
    } else {
      console.log('[INFO]Successfully logged into the CMC org. Fetching Project ID...');
      cmcOrg.query("select Id, Story__r.Sprint__r.Release__r.Project__r.pse__Project_ID__c from CMC_Task__c where id = '"+challenge['sobject']['CMC_Task__c']+"'", resp, function(err, resp){
        try {
          var projectId = resp.records[0]['Story__r']['Sprint__r']['Release__r']['Project__r']['pse__Project_ID__c'];  
          console.log('[INFO]Found projectId: '+projectId);
          callback(projectId);
        } catch (e) {
          console.log('[INFO]No Project ID found for Task.');
        }
      });
    }
  }); 

}

app.listen(port, function(){
  console.log("Express server listening on port %d in %s mode", port, app.settings.env);
});
