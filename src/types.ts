export type Awaitable<T> = T | PromiseLike<T>;

export interface IStatusCheck {
	state: -1 | 0 | 1;
	latency: number;
	time: number;
}

export interface IStatusApp {
	id: string;
	name: string;
	url: string;
	email: string;
	status: IStatusCheck[];
}

const enum EIpcOps {
	DEBUG = 0,
	ADD = 1,
	REMOVE = 2,
}

export interface IIpcEvents {
	[EIpcOps.DEBUG]: any;
	[EIpcOps.ADD]: IStatusAppPingInfo;
	[EIpcOps.REMOVE]: string;
}

type ReverseMap<T> = T[keyof T];

export interface IIpcMessage<T extends keyof IIpcEvents> {
	op: T;
	d: IIpcEvents[T];
}

export type IStatusAppPingInfo = {
	id: IStatusApp['id'];
	url: IStatusApp['url'];
};

export type ServerResponse<T = any> =
	| {
			error: false;
			data: T;
	  }
	| {
			error: true;
			data: string;
	  };

export { EIpcOps };

declare global {
	namespace NodeJS {
		// Alias for compatibility
		interface ProcessEnv extends Dict<string> {
			ZOHO_USER: string;
			ZOHO_PASS: string;
		}
	}

	interface Array<T> {
		random(): T;
	}
}
