import { getApplicationEmail } from './db';
import nodeMailer, { SendMailOptions } from 'nodemailer';

const transporter = nodeMailer.createTransport({
	host: 'smtp.zoho.com',
	secure: true,
	port: 465,
	auth: {
		user: process.env.ZOHO_USER,
		pass: process.env.ZOHO_PASS,
	},
});
export async function sendEmailToAppOwner(
	appId: string,
	subject: string,
	content: string,
	emailAddress?: string
) {
	const email = emailAddress || getApplicationEmail(appId);
	if (!email) {
		return false;
	}

	const mailOptions: SendMailOptions = {
		from: 'status@oyintare.dev',
		to: email,
		subject,
		text: content,
	};

	return await new Promise<boolean>((res) => {
		transporter.sendMail(mailOptions, (e, i) => {
			if (e) {
				console.log('ENV', e);
				console.log(`Error sending email to ${email}\n`, e);

				res(false);
			} else {
				res(true);
			}
		});
	});
}
