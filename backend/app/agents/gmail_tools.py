"""Gmail SMTP tools for sending notifications."""
import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

load_dotenv()

def send_email(to: str, subject: str, body: str) -> dict:
    """Send an email via Gmail SMTP (App Password required)."""
    gmail_user = os.getenv("GMAIL_USER")
    gmail_password = os.getenv("GMAIL_APP_PASSWORD")
    
    if not gmail_user or not gmail_password:
        print("Skipping email: GMAIL_USER or GMAIL_APP_PASSWORD not set in .env")
        return {"status": "skipped", "reason": "missing_credentials"}

    try:
        msg = MIMEMultipart()
        msg['From'] = gmail_user
        msg['To'] = to
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'plain'))

        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(gmail_user, gmail_password)
        server.send_message(msg)
        server.quit()
        
        return {"status": "sent"}
    except Exception as e:
        print(f"Failed to send email: {e}")
        return {"status": "error", "error": str(e)}

