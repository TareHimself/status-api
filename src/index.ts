process.env = { ...process.env, ...require('../keys.json') };
import cluster from 'cluster';
import path from 'path';
import * as os from 'os';
import { Ping } from './ping';

if (cluster.isPrimary) {
	const p = new Ping();

	// Take advantage of multiple CPUs
	const cpus = os.cpus().length;

	if (process.argv.includes('--no-cluster')) {
		cluster.fork(process.env);
	} else {
		for (let i = 0; i < Math.max(cpus, 4); i++) {
			cluster.fork(process.env);
		}
	}
} else {
	require(path.join(__dirname, 'server'));
}
