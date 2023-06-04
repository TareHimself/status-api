import axios, { HttpStatusCode } from 'axios';
import cluster from 'cluster';
import {
	getApplication,
	getApplicationEmail,
	getApplicationsWithStatus,
	getAppsToPing,
	tInsertStatus,
} from './db';
import { EIpcOps, IIpcEvents, IIpcMessage } from './types';
import { sendEmailToAppOwner } from './email';

const PING_TIMEOUT = 4 * 60 * 1000; //5 * 60 * 1000;

export class Ping {
	appsToUrls: { [key: string]: string } = {};
	appsToTimers: { [key: string]: ReturnType<typeof setTimeout> } = {};
	recentStatus: { [appId: string]: number } = getApplicationsWithStatus(
		1
	).reduce((all, app) => {
		if (app.status.length > 0) {
			all[app.id] = app.status[0].state;
		}

		return all;
	}, {});

	constructor() {
		cluster.on('fork', (worker) => {
			worker.on('message', this.onWorkerMessage.bind(this));
		});

		cluster.on('exit', (worker, code) => {
			worker.off('message', this.onWorkerMessage.bind(this));

			if (code !== 0 && !worker.exitedAfterDisconnect) {
				cluster.fork();
			}
		});

		getAppsToPing().forEach((a) => {
			this.addAppToPingItems(a);
		});
	}

	async notifyAppStatusChange(appId: string, status: number) {
		console.log(appId, status, this.recentStatus);
		this.recentStatus[appId] = status;
		const appInfo = getApplication(appId);
		if (!appInfo) {
			return;
		}

		const message =
			status === -1
				? `We cannot reach ${appInfo.name}.`
				: status === 0
				? `${appInfo.name} seems to be having issues.`
				: `${appInfo.name} is online.`;
		await sendEmailToAppOwner(appId, `Status - ${appInfo.name}`, message);
	}

	async deriveStatus(appId: string) {
		if (this.appsToTimers[appId]) {
			delete this.appsToTimers[appId];
		}

		console.log('Pinging', appId);

		try {
			const start = Date.now();
			const res = await axios.head(this.appsToUrls[appId], {
				validateStatus: () => true,
			});
			if (res.status === HttpStatusCode.Ok) {
				tInsertStatus(appId, Date.now() - start, 1);
				if (this.recentStatus[appId] !== 1) {
					this.notifyAppStatusChange(appId, 1);
				}
			} else {
				tInsertStatus(appId, Date.now() - start, 0);
				if (this.recentStatus[appId] !== 0) {
					this.notifyAppStatusChange(appId, 0);
				}
			}
		} catch (e) {
			tInsertStatus(appId, -1, -1);
			if (this.recentStatus[appId] !== -1) {
				this.notifyAppStatusChange(appId, -1);
			}
		}

		this.appsToTimers[appId] = setTimeout(
			this.deriveStatus.bind(this),
			PING_TIMEOUT,
			appId
		);
	}

	addAppToPingItems(app: IIpcEvents[EIpcOps.ADD]) {
		if (this.appsToTimers[app.id]) {
			clearTimeout(this.appsToTimers[app.id]);
		}
		this.appsToUrls[app.id] = app.url;
		this.deriveStatus(app.id);
	}

	removeAppFromPingItems(appId: IIpcEvents[EIpcOps.REMOVE]) {
		if (this.appsToTimers[appId]) {
			clearTimeout(this.appsToTimers[appId]);
			delete this.appsToTimers[appId];
		}

		if (this.appsToUrls[appId]) {
			delete this.appsToUrls[appId];
		}
	}

	async onWorkerMessage(message: IIpcMessage<any>) {
		switch (message.op) {
			case EIpcOps.DEBUG:
				console.log(message.d);
				break;

			case EIpcOps.ADD:
				this.addAppToPingItems(message.d);
				break;

			case EIpcOps.REMOVE:
				this.removeAppFromPingItems(message.d);
				break;

			default:
				break;
		}
	}
}
