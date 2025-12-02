import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY!);
const fromEmail = process.env.FROM_EMAIL || "info@trao.ai";

interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, text, from = fromEmail }: SendEmailOptions) {
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });

    if (error) {
      console.error("❌ Resend email error:", error);
      throw new Error(typeof error === "string" ? error : JSON.stringify(error));
    }

    console.log("✅ Email sent successfully:", data?.id);
    return data;
  } catch (err) {
    console.error("❌ Email helper error:", err);
    throw err;
  }
}
