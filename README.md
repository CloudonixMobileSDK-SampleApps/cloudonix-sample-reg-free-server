# cloudonix-sample-reg-free-server

An example NodeJS server to implement the Cloudonix Registration-Free protocol and support iOS and Android clients.

We use [`node-pushnotifications`](https://www.npmjs.com/package/node-pushnotifications) in this example to make it
easier to support all kinds of target devices, but this project is currently only configured and tested for Android
devices. Work to support iOS devices will be added soon.

# Setup

## Initial Setup

1. Clone this repository.
1. Run `npm install`.
1. Make sure you have `ngrok` installed - we use it to publish out testing server from our local machine so the
   Cloudonix Platform can call it. If you have some other way to publish the server (for example, by running
   the service on a publicly accessible server), you can ignore the ngrok instructions and set up your own.

## Create Firebase Cloud Messaging

1. Go to the [Firebase website](https://firebase.google.com/) and click "Go to console". If you are not logged in to
   your Google account, you'd be asked to log in at this point.
1. Click "Add project", and specify the project name. It may be a good idea to "select parent resource" as well if you
   are putting this server into an organization. Continue and create the project.
1. After the project is created, click the gear icon in the sidebar and go into "Project settings", then into then
   "Cloud Messaging" tab, and click "Manage Service Accounts" which will open Google Cloud IAM console in a new page.
1. In the IAM console "Service Accounts" view, there should already be a service account that Firebase created for you,
   so click on the three dots menu for that account, then select "Manage Keys" - we need an API key to authenticate
   the sample server to Firebase - this is the simplest way to authenticate, though Google recommends you use a
   "workload identity" instead - there would be a link in that page to read more about having better security when
   running in the cloud.
1. Click "Add Key" then "Create new key" and "Create" - which will download a service account key file named
   with your Firebase project name followed by a random string and a `.json` extension. Move that file to the project
   working directory and name it `firebase-service-account-key.json` (this file is git ignored, so it will not be
   published).

## Run The Service

1. Run `npm run-script run`. This would start the server and will wait for registrations and incoming calls.
1. In another terminal, run `npm run-script ngrok`. This would start the ngrok proxy that will forward requests from the
   Cloudonix Platform to the testing service running on your workstation. Record the "Forwarding" HTTPS URL that ngrok
   shows.
1. Log in to the [Cloudonix Cockpit](https://cockpit.cloudonix.io), go into the domain you want to set up to send
   Registration-Free call from, and go into its settings, then to the tab "Domain Settings".
1. Set the URL from ngrok in the "Registration-Free Control Endpoint URL" field, add "`/incoming`" to the end of it
   and click the check mark to apply (e.g. `https://your-server-id.ngrok.io/incoming`).

## Perform A Test Call

1. Set up a mobile application that uses the Cloudonix Mobile SDK (See the [Cloudonix Sample Apps repository](https://github.com/CloudonixMobileSDK-SampleApps)
   if you want to use a ready-made sample app to test), and set it to register push notification and MSISDN using
   the URL you got from ngrok in the previous step, with `/devices` added at the end (e.g.
   `https://your-server-id.ngrok.io/devices`) - see the source code in this repository for the exact details on how to
   format the registration request from the device.
2. Run the application and monitor the example service logs to see that it registered correctly.
3. Make a call into your Cloudonix domain, to the MSISDN registered in the example service (for example, by setting up
   a SIP soft phone to connect to your Cloudonix domain, see the Cloudonix documentation for instructions).

You should now see an incoming call in the example server log, and your app should receive the incoming call
notification.
