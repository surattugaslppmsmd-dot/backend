import nodemailer from "nodemailer";
import path from "path";

export async function sendEmail(
  to: string,
  subject: string,
  pdfPath: string,
  bodyText: string
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "surattugaslppmsmd@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: '"LPPM UNTAG Samarinda" <surattugaslppmsmd@gmail.com>',
    to,
    subject,
    text: bodyText,
    attachments: [
      {
        filename: path.basename(pdfPath),
        path: pdfPath,
      },
    ],
  });
}
