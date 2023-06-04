import cluster from 'cluster';
import express, {
	Application,
	Request as ExpressRequest,
	Response as ExpressResponse,
} from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
	tAddApplication,
	getAppsToPing,
	getStatusHistory,
	getApplicationsWithStatus,
	tUpdateApplication,
	getApplicationWithStatus,
	tRemoveApplication,
	getApplicationEmail,
	getApplication,
} from './db';
import { EIpcOps, IIpcEvents, IIpcMessage, IStatusAppPingInfo } from './types';
import cors from 'cors';
import { buildResponse } from './utils';
import { sendEmailToAppOwner } from './email';

function sendToPingClass<T extends keyof IIpcEvents>(message: IIpcMessage<T>) {
	if (process.send) {
		process.send(message);
	}
}

function addAppToPingList(app: IStatusAppPingInfo) {
	sendToPingClass<EIpcOps.ADD>({
		op: EIpcOps.ADD,
		d: app,
	});
}

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
	res.send('YOLO');
});

app.get('/status', (req, res) => {
	try {
		const maxStatusHistory = parseInt((req.query.m as string) || '', 10) || 10;
		res.send(buildResponse(getApplicationsWithStatus(maxStatusHistory)));
		return;
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.get('/status/:appId', (req, res) => {
	try {
		const maxStatusHistory = parseInt((req.query.m as string) || '', 10) || 10;
		res.send(
			buildResponse(
				getApplicationWithStatus(req.params.appId, maxStatusHistory)
			)
		);
		return;
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.get('/status/state/:appId', (req, res) => {
	try {
		const maxStatusHistory = parseInt((req.query.m as string) || '', 10) || 10;
		res.send(
			buildResponse(getStatusHistory(req.params.appId, maxStatusHistory))
		);
		return;
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.put('/status', async (req, res) => {
	try {
		const appId = tAddApplication(req.body);

		addAppToPingList({ id: appId, ...req.body });
		res.send(buildResponse(appId));
		await sendEmailToAppOwner(
			appId,
			'App Created',
			`Your app ${req.body.name} with id ${appId} , has been created`
		);
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.post('/status/:appId', async (req, res) => {
	try {
		const didUpdate = tUpdateApplication(req.params.appId, req.body);
		if (didUpdate && req.body.url) {
			addAppToPingList({ id: req.params.appId, url: req.body.url });
		}
		res.send(buildResponse(didUpdate));

		if (didUpdate) {
			await sendEmailToAppOwner(
				req.params.appId,
				'App Updated',
				`Your app with id ${req.params.appId} , has been upated`
			);
		}
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.delete('/status/:userId/:appId', async (req, res) => {
	try {
		const email = req.params.userId;
		const appInfo = getApplication(req.params.appId);
		const didUpdate = tRemoveApplication(req.params.appId, email);
		if (didUpdate) {
			sendToPingClass<EIpcOps.REMOVE>({
				op: EIpcOps.REMOVE,
				d: req.params.appId,
			});
		}
		res.send(buildResponse(didUpdate));
		if (didUpdate && appInfo) {
			await sendEmailToAppOwner(
				req.params.appId,
				'App Deleted',
				`Your app ${appInfo.name} with id ${req.params.appId} , has been deleted`,
				email
			);
		}
	} catch (error) {
		console.error(error);
		res.send(buildResponse(error.message, true));
	}
});

app.listen(process.argv.includes('--debug') ? 9090 : 9004, () => {
	sendToPingClass<EIpcOps.DEBUG>({
		op: EIpcOps.DEBUG,
		d: `Server With ID ${process.pid}, Online with ${
			Object.keys(cluster.workers || {}).length
		} workers`,
	});
});
