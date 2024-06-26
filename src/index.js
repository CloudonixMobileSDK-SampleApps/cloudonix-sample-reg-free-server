#!/usr/bin/env node 
'use strict';

const fcmAccount = require('../firebase-service-account-key.json');
const https = require('https');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const firebaseadmin = require("firebase-admin");
const { cloudonixAPI, cloudonixDomain, cloudonixAPIKey } = require("../.secrets.json");

class Database {
	db = new sqlite3.Database(':memory:');
	
	async run(sql, params) {
		return new Promise((res,rej) => {
			function callback(err) { if (err) rej(err); else res(this.lastID); }
			this.db.run(sql, params, callback);
		});
	}
	
	async all(sql, params) {
		return new Promise((res,rej) => {
			function callback(err, rows) { if (err) rej(err); else res(rows); }
			this.db.all(sql, params, callback);
		});
	}
	
	async init() {
		return this.run(`CREATE TABLE IF NOT EXISTS devices (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			os_type VARCHAR(7),
			identifier VARCHAR(40) UNIQUE,
			msisdn VARCHAR(15) UNIQUE
		);`, []);
	}
	
	async listDevices() {
		return this.all("SELECT * FROM devices", []);
	}
	
	async registerDevice(msisdn, identifier, ostype) {
		try {
			let lastid = await this.run('INSERT INTO devices (os_type, identifier, msisdn) VALUES (?, ?, ?)', [ ostype, identifier, msisdn ]);
			console.log(`New device ${ostype}:${identifier} registered MSISDN ${msisdn} => ${lastid}`);
			let device = await this.getDevice(identifier);
			if (!device)
				throw new Error("INSERT did not return any row!");
			return device;
		} catch (err) {
			if (err.code != 'SQLITE_CONSTRAINT')
				throw err;
			if (err.message.includes('devices.identifier'))
				return this.updateMSISDN(identifier, msisdn);
			if (err.message.includes('devices.msisdn')) {
				await this.deleteByMSISDN(msisdn);
				return this.registerDevice(msisdn, identifier, ostype);
			}
			throw err;
		}
	}
	
	async getDevice(identifier) {
		let rows = await this.all('SELECT * FROM devices WHERE identifier = ?', [ identifier ]);
		if (rows.length)
			return rows[0];
		return null;
	}
	
	async getDeviceByMSISDN(msisdn) {
		let rows = await this.all('SELECT * FROM devices WHERE msisdn = ?', [ msisdn ]);
		if (rows.length)
			return rows[0];
		return null;
	}
	
	async updateMSISDN(identifier, msisdn) {
		await this.run('UPDATE devices SET msisdn = ? WHERE identifier = ?', [ msisdn, identifier]);
		console.log(`Updated device ${identifier} with new MSISDN ${msisdn}`);
		return this.getDevice(identifier);
	}
	
	async deleteDevice(identifier) {
		console.log('Removing device', identifier);
		return this.run('DELETE FROM devices WHERE identifier = ?', [ identifier ]);
	}
	
	async deleteByMSISDN(msisdn) {
		console.log(`Removing all devices with msisdn ${msisdn}`);
		return this.run('DELETE FROM devices WHERE msisdn = ?', [ msisdn ]);
	}
}

const app = express();
const db = new Database();
const push = firebaseadmin.initializeApp({
	credential: firebaseadmin.credential.cert(fcmAccount),
	projectId: 'cloudonix-sample-reg-free'
}).messaging();


function cloudonixPost({body, ...options}) {
	console.log(`Calling Cloudonix on https://${cloudonixAPI}${options.path}`);
	return new Promise((resolve,reject) => {
		let request = https.request({
			method: 'POST',
			hostname: cloudonixAPI,
			headers: {
				'Authorization': `Bearer ${cloudonixAPIKey}`,
				'Content-Type': 'application/json',
			},
			...options,
		}, (response) => {
			let chunks = [];
			response.on('data', data => chunks.push(data));
			response.on('end', () => {
				let resBody = Buffer.concat(chunks);
				switch(response.headers['content-type']) {
					case 'application/json':
						resBody = JSON.parse(resBody);
						break;
				}
				console.log("Cloudonix response", resBody);
				if (response.statusCode / 100 == 2)
					resolve(resBody)
				else
					reject(new Error(`Not OK response from Cloudonix: ${resBody}`));
			});
		});
		request.on('error',reject);
		request.write(body);
		request.end();
	});
}

app.use(express.json());

/**
 * Healthcheck responder
 */
app.get('/', (req, res, next) => {
	console.log("Health check");
	res.send({status:true});
});

/**
 * Convenience helper to list all device identifiers.
 * This is for testing and inherently insecure - do not put in production
 */
app.get('/devices', async (req, res) => {
	console.log("Listing devices");
	let devices = await db.listDevices();
	res.send(devices);
});

/**
 * Register a new device by sending a JSON as such: {"identifier": "your-app-PN-identifier", "msisdn": "number-you-want-to-use", "type": "android|ios"}
 */
app.post('/devices', async (req, res) => {
	console.log("Registering a new device");
	if (!req.body || !req.body.identifier)
		return res.status(400).send({status:false, message:"Missing device 'identifier'"});
	if (!req.body.msisdn)
		return res.status(400).send({status:false, message:"Missing device 'msisdn'"});
 	let device = await db.registerDevice(req.body.msisdn, req.body.identifier, req.body.type || 'android');
	res.send(device);
});

app.post("/dial", async (req, res) => {
	console.log("Starting a new session");
	if (!req.body || !req.body.msisdn)
		return res.status(400).send({status: false, message:"Missing device 'msisdn'"});
	if (!req.body.destination)
		return res.status(400).send({status: false, message:"Missing dial 'destination'"});
	let msisdn = req.body.msisdn;
	let destination = req.body.destination;
	try {
		var apiResponse = await cloudonixPost({
			path: `/calls/${cloudonixDomain}/outgoing/${msisdn}`,
			body: JSON.stringify({
				callerId: msisdn,
				destination: destination,
			})
		});
		console.log("Created Cloudonix session", apiResponse.token);
		return res.status(201).send({session: apiResponse.token});
	} catch (err) {
		console.error("Error in call to Cloudonix:", JSON.stringify(err));
		return res.status(500).send({status: false, message: "Failed to create session"});
	}
});

/**
 * Handle the Cloudonix Platform incoming call message
 */
app.post('/incoming', async (req, res) => {
	console.log("Receiving an incoming call");
	let body = req.body;
	if (!body || !body.session)
		return res.status(400).send({status: false, message: 'Not a valid Cloudonix registration-free message!'});
	let device = await db.getDeviceByMSISDN(body.dnid);
	if (!device)
		return res.status(404).send({status: false, message: `Subscriber ${body.dnid} could not be found`});
	let notification = { 
		session: body.session,
		callerId: body['caller-id'],
		ringingURL: `${body.endpoint}/calls/${body.domain}/ringing/${body.subscriber.msisdn}/${body.session}`,
	};
	console.log('Sending push notification to', device, 'with message', notification);
	let pushResult = await push.sendToDevice(device.identifier, { data: notification }, {
		priority: 'high',
		timeToLive: 60
	});
	console.log("Push result: %j", pushResult);
	if (pushResult.failureCount > 0) {
		let error = (((pushResult.results || [])[0] || {}).error || {}).code || 'unknown-error';
		if (error == 'messaging/registration-token-not-registered')
			db.deleteDevice(device.identifier);
		res.status(500).send({
			status: false,
			message: `Failed to send push notification due to ${error}`
		});
	} else {
		res.status(201).send({status: true, message: 'Sent push notification'});
	}
});

db.init().then(_ => {
	console.log("Database setup complete");
	app.listen(8780);
	console.log("Server is listening on http://localhost:8780/");
});
