import path from 'path';
import cluster from 'cluster';
import { existsSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { stat } from 'fs/promises';
import { IStatusApp, IStatusAppPingInfo, IStatusCheck } from './types';

const DB_PATH = path.join(process.cwd(), 'database');
const BACKUPS_PATH = path.join(process.cwd(), 'backups');
if (cluster.isPrimary) {
	if (!existsSync(DB_PATH)) mkdirSync(DB_PATH, { recursive: true });

	if (!existsSync(BACKUPS_PATH)) mkdirSync(BACKUPS_PATH, { recursive: true });
}

const db = Database(path.join(DB_PATH, 'database.db'));

function time(sep = '') {
	const currentDate = new Date();

	if (sep === '') {
		return currentDate.toUTCString();
	}

	const date = ('0' + currentDate.getUTCDate()).slice(-2);

	const month = ('0' + (currentDate.getUTCMonth() + 1)).slice(-2);

	const year = currentDate.getUTCFullYear();

	const hours = ('0' + currentDate.getUTCHours()).slice(-2);

	const minutes = ('0' + currentDate.getUTCMinutes()).slice(-2);

	const seconds = ('0' + currentDate.getUTCSeconds()).slice(-2);

	return `${year}${sep}${month}${sep}${date}${sep}${hours}${sep}${minutes}${sep}${seconds}`;
}

if (cluster.isPrimary) {
	const initialStatements = [
		`
    CREATE TABLE IF NOT EXISTS apps(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
		email TEXT NOT NULL
    ) WITHOUT ROWID;
    `,
		`
    CREATE TABLE IF NOT EXISTS status(
        app TEXT NOT NULL,
        state INTEGER NOT NULL,
		latency INTEGER NOT NULL,
        time INTEGER NOT NULL,
		FOREIGN KEY(app) REFERENCES apps(id)
    );
    `,
		`
    CREATE INDEX IF NOT EXISTS idx_status
    ON status (time);
    `,
	];

	// fix concurrency issues
	db.pragma('journal_mode = WAL');

	db.pragma('wal_checkpoint(RESTART)');

	const checkDbSize = async () => {
		try {
			const stats = await stat(path.join(DB_PATH, 'database.db-wal'));
			if (stats.size / (1024 * 1024) > 50) {
				db.pragma('wal_checkpoint(RESTART)');
			}
		} catch (error: any) {
			if (error.code !== 'ENOENT') throw error;
		}
	};

	setInterval(checkDbSize, 5000).unref();

	db.backup(path.join(BACKUPS_PATH, `backup-${time('-')}.db`));
	setInterval(async () => {
		db.backup(path.join(BACKUPS_PATH, `backup-${time('-')}.db`));
	}, 1000 * 60 * 60 * 12).unref(); // every 12 hours

	db.transaction((statements: string[]) => {
		statements.forEach((statement) => {
			db.prepare(statement).run();
		});
	}).immediate(initialStatements);
}

export function pad(number: number) {
	return number < 10 ? `0${number}` : `${number}`;
}

const InsertStatusStatement = db.prepare<{
	app: string;
	state: number;
	latency: number;
	time: number;
}>(
	`INSERT INTO status (app,state,latency,time) VALUES(@app,@state,@latency,@time)`
);

const DeleteExpiredStatusStatement = db.prepare<{
	ttl: number;
}>(`DELETE FROM status WHERE time < @ttl`);

const GetAllAppsPingInfoStatement = db.prepare(`SELECT id,url FROM apps`);
const GetAllAppsTrackedStatement = db.prepare(`SELECT id,name,url FROM apps`);
const GetTrackedAppStatement = db.prepare<Pick<IStatusApp, 'id'>>(
	`SELECT id,name,url FROM apps WHERE id=@id`
);
const GetAppStatusHistoryStatement = db.prepare<{ app: string; lim: number }>(
	`SELECT state,latency,time FROM status WHERE app=@app ORDER BY time DESC LIMIT @lim`
);

const InsertAppStatement = db.prepare<Omit<IStatusApp, 'status'>>(
	`INSERT INTO apps (id,name,email,url) VALUES(@id,@name,@email,@url)`
);

const GetAppEmailStatement = db.prepare<{ id: string }>(
	`SELECT email FROM apps WHERE id=@id`
);

const GetAppStatement = db.prepare<{ id: string }>(
	`SELECT id,name,url FROM apps WHERE id=@id`
);

export function getAppsToPing() {
	return GetAllAppsPingInfoStatement.all() as IStatusAppPingInfo[];
}

export function getStatusHistory(appId: string, limit: number = 10) {
	return GetAppStatusHistoryStatement.all({
		app: appId,
		lim: limit,
	}) as IStatusCheck[];
}

export function getApplicationWithStatus(id: string, statusLimit: number = 10) {
	const app = GetTrackedAppStatement.all({ id: id })[0] as
		| IStatusApp
		| undefined;
	if (!app) {
		throw new Error('App does not exist');
	}
	app.status = getStatusHistory(app.id, statusLimit);
	return app;
}

export function getApplicationsWithStatus(statusLimit: number = 10) {
	return (GetAllAppsTrackedStatement.all() as IStatusApp[]).map((app) => {
		app.status = getStatusHistory(app.id, statusLimit);
		return app;
	});
}

export function getApplication(appId: string) {
	return GetAppStatement.all({ id: appId })[0] as IStatusApp | undefined;
}

export function getApplicationEmail(appId: string) {
	return (GetAppEmailStatement.all({ id: appId }) as { email: string }[])[0]
		?.email as string | undefined;
}

const tInsertStatus = db.transaction(
	(id: string, latency: number, state: number) => {
		InsertStatusStatement.run({
			app: id,
			state,
			latency,
			time: Math.round(Date.now() / 1000),
		});

		DeleteExpiredStatusStatement.run({
			ttl: Math.round(Date.now() / 1000) - 60 * 60 * 48,
		});
	}
);

const tUpdateApplication = db.transaction(
	(id: string, fields: { [key: string]: string }) => {
		const updateFields = Object.keys(fields).reduce((total, key) => {
			return total + `${key} =@${key} `;
		}, ' ');
		return (
			db.prepare(`UPDATE apps SET${updateFields}WHERE id=@id`).run({
				...fields,
				id: id,
			}).changes > 0
		);
	}
);

const tAddApplication = db.transaction(
	(config: Omit<IStatusApp, 'status' | 'id'>) => {
		const applicationId = uuidv4();

		if (
			InsertAppStatement.run({
				id: applicationId,
				...config,
			}).changes > 0
		) {
			return applicationId;
		}

		throw new Error('Failed to create application');
	}
);

const tRemoveApplication = db.transaction((id: string, email: string) => {
	console.log(email, getApplicationEmail(id));
	if (
		getApplicationEmail(id)?.toLowerCase().trim() !== email.toLowerCase().trim()
	) {
		throw new Error(`Email's do not match`);
	}

	db.prepare(`DELETE FROM status WHERE app=@id`).run({
		id: id,
	});
	return (
		db.prepare(`DELETE FROM apps WHERE id=@id`).run({ id: id, email }).changes >
		0
	);
});

export {
	tInsertStatus,
	tAddApplication,
	tUpdateApplication,
	tRemoveApplication,
};
