cs-jeffrey
==========

Node.js app using faye for pub/sub with Force.com Streaming API. Whenever a challenge
status has changed or the number of submissions has changed and there is a CMC task
for the challenge, it streams the record to cs-jeffrey. The app updates the CMC 
org with the current status and number of submissions and then grabs the project
id associated with the task and writes that back into the CloudSpokes challenge so 
that it can be used for payment processing.

## Contributors
Jeff Douglas