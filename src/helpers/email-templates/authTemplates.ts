export const resetPassWordTemplate = (resetLink: string) => {
  return `<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                <table role="presentation" style="max-width: 500px; width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #f0f4ff 0%, #ffffff 100%); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15);">
                    
                    <!-- Icon -->
                    <tr>
                        <td align="center" style="padding: 50px 40px 30px;">
                            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M22 6L12 13L2 6" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 0 40px 30px;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: #1a202c; letter-spacing: -0.5px;">Reset Your Password</h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                We received a request to reset your password for your Longwall account. Click the button below to create a new password.
                            </p>
                            
                            <!-- Button -->
                            <table role="presentation" style="margin: 0 auto;">
                                <tr>
                                    <td style="border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                        <a href="${resetLink}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                                            Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 28px 0 0; font-size: 14px; line-height: 1.6; color: #718096; text-align: center;">
                                This link will expire in 1 hour for security reasons.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 40px;">
                            <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);"></div>
                        </td>
                    </tr>
                    
                    <!-- Alternative Link -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            <p style="margin: 0 0 12px; font-size: 13px; color: #718096; text-align: center;">
                                If the button doesn't work, copy and paste this link:
                            </p>
                            <div style="padding: 12px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0;">
                                <a href="${resetLink}" style="font-size: 12px; color: #667eea; word-break: break-all; text-decoration: none;">${resetLink}</a>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px 40px; text-align: center;">
                            <p style="margin: 0 0 8px; font-size: 13px; color: #718096; line-height: 1.5;">
                                Didn't request a password reset?<br>You can safely ignore this email.
                            </p>
                            <p style="margin: 16px 0 0; font-size: 12px; color: #a0aec0;">
                                © 2025 Longwall. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
                
                <!-- Bottom spacing -->
                <table role="presentation" style="margin-top: 20px;">
                    <tr>
                        <td style="text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                                This email was sent by Longwall
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export const getPasswordResetSuccessEmail = (userEmail: string, loginLink: string) => {
  const timestamp =
    new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC";

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Successful</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                <table role="presentation" style="max-width: 500px; width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #f0f4ff 0%, #ffffff 100%); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15);">
                    
                    <!-- Icon -->
                    <tr>
                        <td align="center" style="padding: 50px 40px 30px;">
                            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.3);">
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M20 6L9 17L4 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 0 40px 20px;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: #1a202c; letter-spacing: -0.5px;">Password Reset Successful</h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                Your password has been successfully reset. You can now log in to your Longwall account using your new password.
                            </p>
                            
                            <!-- Info Box -->
                            <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 28px;">
                                <table role="presentation" style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 0 0 12px 0; border-bottom: 1px solid #f7fafc;">
                                            <p style="margin: 0; font-size: 13px; color: #718096;">Account</p>
                                            <p style="margin: 4px 0 0; font-size: 15px; color: #1a202c; font-weight: 500;">${userEmail}</p>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 12px 0 0 0;">
                                            <p style="margin: 0; font-size: 13px; color: #718096;">Changed on</p>
                                            <p style="margin: 4px 0 0; font-size: 15px; color: #1a202c; font-weight: 500;">${timestamp}</p>
                                        </td>
                                    </tr>
                                </table>
                            </div>
                            
                            <!-- Button -->
                            <table role="presentation" style="margin: 0 auto;">
                                <tr>
                                    <td style="border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                        <a href="${loginLink}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                                            Go to Login
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 40px;">
                            <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);"></div>
                        </td>
                    </tr>
                    
                    <!-- Security Notice -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            <div style="background-color: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 16px;">
                                <table role="presentation">
                                    <tr>
                                        <td style="padding-right: 12px; vertical-align: top;">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                <path d="M2 17L12 22L22 17" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                <path d="M2 12L12 17L22 12" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                            </svg>
                                        </td>
                                        <td>
                                            <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.5;">
                                                <strong style="font-weight: 600;">Didn't make this change?</strong><br>
                                                If you didn't reset your password, please contact our support team immediately to secure your account.
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px 40px; text-align: center;">
                            <p style="margin: 0 0 8px; font-size: 13px; color: #718096; line-height: 1.5;">
                                For security tips and account management,<br>visit your account settings.
                            </p>
                            <p style="margin: 16px 0 0; font-size: 12px; color: #a0aec0;">
                                © 2025 Longwall. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
                
                <!-- Bottom spacing -->
                <table role="presentation" style="margin-top: 20px;">
                    <tr>
                        <td style="text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                                This email was sent by Longwall
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
    .replace(/\$\{userEmail\}/g, userEmail)
    .replace(/\$\{timestamp\}/g, timestamp)
    .replace(/\$\{loginLink\}/g, loginLink);
};

export const getEmailVerificationTemplate = (verificationUrl: string) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                <table role="presentation" style="max-width: 500px; width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #f0f4ff 0%, #ffffff 100%); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15);">
                    
                    <!-- Icon -->
                    <tr>
                        <td align="center" style="padding: 50px 40px 30px;">
                            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85781 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M22 4L12 14.01L9 11.01" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 0 40px 20px;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: #1a202c; letter-spacing: -0.5px;">Verify Your Email</h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                Welcome to <strong style="color: #1a202c;">Longwall</strong>! 🎉
                            </p>
                            <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                To get started, please verify your email address by clicking the button below.
                            </p>
                            
                            <!-- Button -->
                            <table role="presentation" style="margin: 0 auto;">
                                <tr>
                                    <td style="border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                        <a href="${verificationUrl}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                                            Verify Email Address
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 28px 0 0; font-size: 14px; line-height: 1.6; color: #718096; text-align: center;">
                                This link will expire in 24 hours for security reasons.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 40px;">
                            <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);"></div>
                        </td>
                    </tr>
                    
                    <!-- Alternative Link -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            <p style="margin: 0 0 12px; font-size: 13px; color: #718096; text-align: center;">
                                If the button doesn't work, copy and paste this link:
                            </p>
                            <div style="padding: 12px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0;">
                                <a href="${verificationUrl}" style="font-size: 12px; color: #667eea; word-break: break-all; text-decoration: none;">${verificationUrl}</a>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Why verify box -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <div style="background-color: #f7fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0;">
                                <p style="margin: 0 0 8px; font-size: 14px; color: #1a202c; font-weight: 600;">
                                    Why verify your email?
                                </p>
                                <p style="margin: 0; font-size: 13px; color: #4a5568; line-height: 1.5;">
                                    Email verification helps us ensure your account security and allows us to send you important updates about your account.
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px 40px; text-align: center;">
                            <p style="margin: 0 0 8px; font-size: 13px; color: #718096; line-height: 1.5;">
                                Didn't create an account?<br>You can safely ignore this email.
                            </p>
                            <p style="margin: 16px 0 0; font-size: 12px; color: #a0aec0;">
                                © 2025 Longwall. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
                
                <!-- Bottom spacing -->
                <table role="presentation" style="margin-top: 20px;">
                    <tr>
                        <td style="text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                                This email was sent by Longwall
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`.replace(/\$\{verificationUrl\}/g, verificationUrl);
};

export const getInvitationEmailTemplate = (name: string, role: string, inviteLink: string) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>You've Been Invited</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 60px 20px;">
                <table role="presentation" style="max-width: 500px; width: 100%; border-collapse: collapse; background: linear-gradient(180deg, #f0f4ff 0%, #ffffff 100%); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.15);">
                    
                    <!-- Icon -->
                    <tr>
                        <td align="center" style="padding: 50px 40px 30px;">
                            <div style="width: 80px; height: 80px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);">
                                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M20 21V19C20 17.9391 19.5786 16.9217 18.8284 16.1716C18.0783 15.4214 17.0609 15 16 15H8C6.93913 15 5.92172 15.4214 5.17157 16.1716C4.42143 16.9217 4 17.9391 4 19V21" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M12 11C14.2091 11 16 9.20914 16 7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7C8 9.20914 9.79086 11 12 11Z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M20 21V19C19.9949 18.1172 19.6979 17.2608 19.1553 16.5644C18.6126 15.868 17.8548 15.3707 17 15.15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Title -->
                    <tr>
                        <td align="center" style="padding: 0 40px 20px;">
                            <h1 style="margin: 0; font-size: 28px; font-weight: 600; color: #1a202c; letter-spacing: -0.5px;">You've Been Invited!</h1>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <p style="margin: 0 0 8px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                Hi <strong style="color: #1a202c;">${name}</strong>! 👋
                            </p>
                            <p style="margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #4a5568; text-align: center;">
                                You've been invited to join <strong style="color: #1a202c;">Longwall</strong> as a <strong style="color: #667eea;">${role}</strong>.
                            </p>
                            
                            <!-- Button -->
                            <table role="presentation" style="margin: 0 auto;">
                                <tr>
                                    <td style="border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                                        <a href="${inviteLink}" style="display: inline-block; padding: 16px 48px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                                            Accept Invitation
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <p style="margin: 28px 0 0; font-size: 14px; line-height: 1.6; color: #718096; text-align: center;">
                                This invitation will expire in 24 hours for security reasons.
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 40px;">
                            <div style="height: 1px; background: linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%);"></div>
                        </td>
                    </tr>
                    
                    <!-- Alternative Link -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            <p style="margin: 0 0 12px; font-size: 13px; color: #718096; text-align: center;">
                                If the button doesn't work, copy and paste this link:
                            </p>
                            <div style="padding: 12px 16px; background-color: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0;">
                                <a href="${inviteLink}" style="font-size: 12px; color: #667eea; word-break: break-all; text-decoration: none;">${inviteLink}</a>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- What's next box -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <div style="background-color: #f7fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0;">
                                <p style="margin: 0 0 8px; font-size: 14px; color: #1a202c; font-weight: 600;">
                                    What happens next?
                                </p>
                                <p style="margin: 0; font-size: 13px; color: #4a5568; line-height: 1.5;">
                                    After accepting the invitation, you'll be able to set up your account and start collaborating with your team on Longwall.
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 30px 40px 40px; text-align: center;">
                            <p style="margin: 0 0 8px; font-size: 13px; color: #718096; line-height: 1.5;">
                                Didn't expect this invitation?<br>You can safely ignore this email.
                            </p>
                            <p style="margin: 16px 0 0; font-size: 12px; color: #a0aec0;">
                                © 2025 Longwall. All rights reserved.
                            </p>
                        </td>
                    </tr>
                </table>
                
                <!-- Bottom spacing -->
                <table role="presentation" style="margin-top: 20px;">
                    <tr>
                        <td style="text-align: center;">
                            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.8);">
                                This email was sent by Longwall
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
    .replace(/\$\{name\}/g, name)
    .replace(/\$\{role\}/g, role)
    .replace(/\$\{inviteLink\}/g, inviteLink);
};
