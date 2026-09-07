import io
import base64
from PIL import Image, ImageDraw

def generate_qr_image(data: str, box_size: int = 10, border: int = 2) -> Image.Image:
    """Generate a high-contrast QR code image."""
    try:
        import qrcode
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_H,
            box_size=box_size,
            border=border,
        )
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0f172a", back_color="#ffffff")
        return img
    except ImportError:
        # Fallback image generator with data label if qrcode is not installed
        img = Image.new("RGB", (200, 200), color="#ffffff")
        draw = ImageDraw.Draw(img)
        draw.rectangle([10, 10, 190, 190], outline="#0f172a", width=3)
        draw.text((20, 90), "Docurama QR Seal", fill="#0f172a")
        return img

def generate_qr_base64(data: str, box_size: int = 10, border: int = 2) -> str:
    """Generate QR code and return as Base64 PNG data URL."""
    img = generate_qr_image(data, box_size=box_size, border=border)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"

def save_qr_file(data: str, output_path: str, box_size: int = 10, border: int = 2):
    """Save QR code image directly to file."""
    img = generate_qr_image(data, box_size=box_size, border=border)
    img.save(output_path, format="PNG")
