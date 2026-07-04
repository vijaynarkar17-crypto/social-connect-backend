import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const t = getTransporter();
  if (!t) {
    console.log(`[Email stub] To: ${to} | ${subject}`);
    return;
  }
  await t.sendMail({ from: process.env.SMTP_USER, to, subject, html });
}

export async function sendOtpEmail(to: string, otp: string) {
  await sendEmail(to, 'Social Connect - Password Reset OTP', `
    <h2>Your OTP code</h2>
    <p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p>
    <p>Expires in 10 minutes.</p>
  `);
}

export async function sendVerifyEmail(to: string, token: string) {
  const url = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await sendEmail(to, 'Verify your Social Connect email', `
    <h2>Verify your email</h2>
    <p><a href="${url}">Click here to verify</a></p>
  `);
}
