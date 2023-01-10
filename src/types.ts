
export type Awaitable<T> = T | PromiseLike<T>;

export interface IStatusCheck {
	state: 0 | 1;
	latency: number;
	time: number;
}

export interface IStatusApp {
	id: string;
	name: string;
	url: string;
	status: IStatusCheck[]
}

const enum EIpcOps {
	DEBUG = 0,
	ADD = 1,
	REMOVE = 2
}

export interface IIpcEvents {
	[EIpcOps.DEBUG]: any,
	[EIpcOps.ADD]: IStatusAppPingInfo,
	[EIpcOps.REMOVE]: string
}

type ReverseMap<T> = T[keyof T];

export interface IIpcMessage<T extends keyof IIpcEvents> {
	op: T;
	d: IIpcEvents[T];
}

export type IStatusAppPingInfo = { id: IStatusApp['id'], url: IStatusApp['url'] }

export {
	EIpcOps
}