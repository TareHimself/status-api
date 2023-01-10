import cluster from 'cluster';
import express, { Application, Request as ExpressRequest, Response as ExpressResponse, } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { tAddApplication, getAppsToPing, getStatusHistory, getApplicationsWithStatus, tUpdateApplication, getApplicationWithStatus, tRemoveApplication } from './db';
import { EIpcOps, IIpcEvents, IIpcMessage, IStatusAppPingInfo } from './types';
import cors from 'cors';


function sendToPingClass<T extends keyof IIpcEvents>(message: IIpcMessage<T>) {
	if (process.send) {
		process.send(message)
	}
}

function addAppToPingList(app: IStatusAppPingInfo) {
	sendToPingClass<EIpcOps.ADD>({
		op: EIpcOps.ADD,
		d: app
	})
}

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
	res.send("YOLO")
	sendToPingClass<EIpcOps.DEBUG>({ op: EIpcOps.DEBUG, d: "EXAMPLE MESSAGE" })
})

app.get('/status', (req, res) => {
	try {
		const maxStatusHistory = parseInt(req.query.m as string || "", 10) || 10
		res.send({
			success: true,
			data: getApplicationsWithStatus(maxStatusHistory)
		})
	} catch (error) {
		res.send({
			success: false,
			data: []
		})
	}

})

app.get('/status/:appId', (req, res) => {
	try {

		const maxStatusHistory = parseInt(req.query.m as string || "", 10) || 10

		const application = getApplicationWithStatus(req.params.appId, maxStatusHistory)[0]

		if (!application) {
			res.send({
				success: false,
				data: null
			})
			return;
		}

		res.send({
			success: true,
			data: application
		})
	} catch (error) {
		res.send({
			success: false,
			data: null
		})
	}
})

app.get('/status/state/:appId', (req, res) => {
	try {
		const maxStatusHistory = parseInt(req.query.m as string || "", 10) || 10
		res.send({
			success: true,
			data: getStatusHistory(req.params.appId, maxStatusHistory)
		})
	} catch (error) {
		res.send({
			success: false,
			data: []
		})
	}
})

app.put('/status', (req, res) => {
	const payload = req.body
	if (!payload.name || !payload.url) {
		res.send({
			success: false,
			data: 'missing fields'
		})
	}

	try {
		const id = uuidv4();

		tAddApplication(id, payload.name, payload.url);

		res.send({
			success: true,
			data: id
		})

		addAppToPingList({ id: id, url: payload.url })

		return
	} catch (error) {
		res.send({
			success: false,
			data: error.message
		})
	}

})

app.post('/status/:appId', (req, res) => {
	try {

		if (!req.body || !(req.body.name || req.body.url)) {
			res.send({
				success: false,
				data: 'Missing fields'
			})
			return;
		}

		if (!Object.keys(req.body).every(a => a === "name" || a === "url")) {
			res.send({
				success: false,
				data: 'One or more fields are incorrect'
			})
			return
		}

		tUpdateApplication(req.params.appId, req.body);

		if (req.body.url) {
			addAppToPingList({ id: req.params.appId, url: req.body.url })
		}

		res.send({
			success: true,
			data: 'Updated'
		})
		return
	} catch (error) {
		res.send({
			success: false,
			data: error.message
		})
	}


})

app.delete('/status/:appId', (req, res) => {
	try {
		sendToPingClass<EIpcOps.REMOVE>({
			op: EIpcOps.REMOVE,
			d: req.params.appId
		})

		tRemoveApplication(req.params.appId);

		res.send({
			success: true,
			data: 'Deleted'
		})
		return
	} catch (error) {
		res.send({
			success: false,
			data: error.message
		})
	}
})


app.listen(process.argv.includes('--debug') ? 9090 : 80, () => {
	sendToPingClass<EIpcOps.DEBUG>({
		op: EIpcOps.DEBUG,
		d: `Server With ID ${process.pid}, Online`
	})
})
