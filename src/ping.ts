import axios, { HttpStatusCode } from 'axios';
import cluster from 'cluster';
import { getAppsToPing, tInsertStatus } from './db';
import { EIpcOps, IIpcEvents, IIpcMessage, IStatusAppPingInfo } from './types';

const PING_TIMEOUT = 5 * 60 * 1000;

export class Ping {
	appsToUrls: { [key: string]: string };
	appsToTimers: { [key: string]: ReturnType<typeof setTimeout> };

	constructor() {
		this.appsToTimers = {};
		this.appsToUrls = {};

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

	async deriveStatus(appId: string) {
		if (this.appsToTimers[appId]) {
			delete this.appsToTimers[appId];
		}

		try {
			const start = Date.now();
			const res = await axios.head(this.appsToUrls[appId], {
				validateStatus: () => true,
			});
			if (res.status === HttpStatusCode.Ok) {
				tInsertStatus(appId, Date.now() - start, 1);
			} else {
				tInsertStatus(appId, Date.now() - start, 0);
			}
		} catch (e) {
			tInsertStatus(appId, -1, 0);
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
