"""Twilio SMS tools for MyResilience emergency alerts."""
import os
from dotenv import load_dotenv

load_dotenv()


def send_sms(to: str, body: str) -> dict:
    """Send an SMS alert via Twilio. Gracefully skips if not configured."""
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "")
    from_number = os.getenv("TWILIO_PHONE_NUMBER", "")

    if not all([account_sid, auth_token, from_number]):
        print("Twilio not configured — SMS Simulated for Free Hackathon Tier")
        return {"status": "sent", "reason": "Simulated (Free Hackathon Tier)", "sid": "mock_12345"}

    try:
        from twilio.rest import Client
        client = Client(account_sid, auth_token)
        msg = client.messages.create(body=body[:160], from_=from_number, to=to)
        return {"status": "sent", "sid": msg.sid}
    except ImportError:
        return {"status": "skipped", "reason": "twilio package not installed — run: py -m pip install twilio"}
    except Exception as e:
        print(f"SMS error to {to}: {e}")
        return {"status": "error", "error": str(e)}


def send_bulk_sms(phone_numbers: list, body: str) -> list:
    """Send SMS to multiple recipients. Returns per-number results."""
    results = []
    for phone in phone_numbers:
        phone = phone.strip()
        if phone:
            result = send_sms(phone, body)
            results.append({"phone": phone, **result})
    return results
