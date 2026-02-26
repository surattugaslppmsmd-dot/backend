import nodemailer from "nodemailer";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(
  to: string,
  subject: string,
  attachment: EmailAttachment | null,
  bodyText: string
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "surattugaslppmsmd@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD, 
    },
  });

  const mailOptions: any = {
    from: '"LPPM UNTAG Samarinda" <surattugaslppmsmd@gmail.com>',
    to,
    subject,
    text: bodyText,
  };

  if (attachment) {
    mailOptions.attachments = [
      {
        filename: attachment.filename,
        content: attachment.content,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ];
  }

  await transporter.sendMail(mailOptions);
}
