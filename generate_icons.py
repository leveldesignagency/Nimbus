#!/usr/bin/env python3
"""Generate placeholder icons for CursorIQ extension"""

from PIL import Image, ImageDraw, ImageFont
import os

def generate_icon(size, output_path):
    """Generate a simple icon with a circle and question mark"""
    # Create image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw circle background
    margin = 2
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=(74, 144, 226, 255)  # #4A90E2
    )
    
    # Draw question mark
    try:
        # Try to use a system font
        font_size = int(size * 0.6)
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
    except:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", font_size)
        except:
            # Fallback to default font
            font = ImageFont.load_default()
    
    # Get text dimensions for centering
    bbox = draw.textbbox((0, 0), "?", font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Draw centered question mark
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]
    draw.text((x, y), "?", fill=(255, 255, 255, 255), font=font)
    
    # Save
    img.save(output_path, 'PNG')
    print(f"Generated {output_path} ({size}x{size})")

if __name__ == "__main__":
    # Create assets directory if it doesn't exist
    os.makedirs("assets", exist_ok=True)
    
    # Generate icons
    for size in [16, 48, 128]:
        generate_icon(size, f"assets/icon{size}.png")
    
    print("All icons generated successfully!")


