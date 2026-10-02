#!/usr/bin/env python3
"""
HypeDE TikTok Promo Video Generator
Создает крутое промо-видео с плавными анимациями для TikTok
"""

from moviepy import *
from moviepy.video.fx import Resize, Scroll, FadeIn, FadeOut, MultiplySpeed
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import textwrap

# === CONFIGURATION ===
INPUT_DIR = "docs/images"
OUTPUT_FILE = "hypede_promo_tiktok.mp4"
RESOLUTION = (1080, 1920)  # 9:16 for TikTok
FPS = 30
DURATION_PER_IMAGE = 2.0  # seconds per screenshot
TOTAL_DURATION = 25  # seconds

# Colors
PRIMARY_COLOR = (78, 154, 245)  # Blue-500
SECONDARY_COLOR = (255, 255, 255)  # White
TEXT_COLOR = (255, 255, 255)  # White
BACKGROUND_COLOR = (15, 23, 42)  # Dark blue-gray
ACCENT_COLOR = (245, 158, 11)  # Amber-500

def get_font(size, bold=True):
    """Get font with fallback"""
    try:
        if bold:
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
        else:
            return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except:
        try:
            if bold:
                return ImageFont.truetype("/usr/share/fonts/truetype/roboto/Roboto-Bold.ttf", size)
            else:
                return ImageFont.truetype("/usr/share/fonts/truetype/roboto/Roboto-Regular.ttf", size)
        except:
            return ImageFont.load_default()

def add_text_to_image(img_array, text, y_position, size=60, color=ACCENT_COLOR, bold=True):
    """Add text to an image array"""
    img = Image.fromarray(img_array)
    draw = ImageDraw.Draw(img)
    font = get_font(size, bold=bold)
    
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = (RESOLUTION[0] - text_width) // 2
    y = y_position
    
    draw.text((x, y), text, font=font, fill=color)
    
    return np.array(img)

def create_gradient_overlay(color1, color2, direction='vertical'):
    """Create gradient overlay"""
    w, h = RESOLUTION
    gradient = np.zeros((h, w, 3), dtype=np.uint8)
    
    for i in range(h):
        ratio = i / h
        for j in range(w):
            if direction == 'vertical':
                r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
                g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
                b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
            else:
                r = int(color1[0] * (1 - j/w) + color2[0] * (j/w))
                g = int(color1[1] * (1 - j/w) + color2[1] * (j/w))
                b = int(color1[2] * (1 - j/w) + color2[2] * (j/w))
            gradient[i, j] = [r, g, b]
    
    return gradient

def create_intro_frame():
    """Create intro frame with logo and tagline"""
    # Background
    bg = np.zeros((RESOLUTION[1], RESOLUTION[0], 3), dtype=np.uint8)
    bg[:, :] = BACKGROUND_COLOR
    
    # Gradient overlay
    gradient = create_gradient_overlay((30, 41, 59), (78, 154, 245), 'vertical')
    bg = np.clip(bg + gradient, 0, 255).astype(np.uint8)
    
    # Load and add logo
    logo_path = os.path.join(INPUT_DIR, "logo.png")
    if os.path.exists(logo_path):
        logo = Image.open(logo_path)
        logo_w, logo_h = logo.size
        scale = 400 / logo_w
        new_w, new_h = 400, int(logo_h * scale)
        logo = logo.resize((new_w, new_h))
        logo_array = np.array(logo)
        
        logo_x = (RESOLUTION[0] - new_w) // 2
        logo_y = (RESOLUTION[1] - new_h) // 2 - 200
        
        # Paste logo
        if logo_array.shape[2] == 4:  # RGBA
            alpha = logo_array[:, :, 3] / 255.0
            for c in range(3):
                bg[logo_y:logo_y+new_h, logo_x:logo_x+new_w, c] = (
                    bg[logo_y:logo_y+new_h, logo_x:logo_x+new_w, c] * (1 - alpha) +
                    logo_array[:, :, c] * alpha
                )
        else:
            bg[logo_y:logo_y+new_h, logo_x:logo_x+new_w] = logo_array
    
    # Add tagline
    bg = add_text_to_image(bg, "Рабочий стол в стиле Chrome OS", 1000, size=50, color=SECONDARY_COLOR, bold=False)
    bg = add_text_to_image(bg, "на основе GNOME Shell", 1100, size=50, color=SECONDARY_COLOR, bold=False)
    
    return bg

def create_outro_frame():
    """Create outro frame with call to action"""
    bg = np.zeros((RESOLUTION[1], RESOLUTION[0], 3), dtype=np.uint8)
    bg[:, :] = BACKGROUND_COLOR
    
    # Add text
    bg = add_text_to_image(bg, "Попробуйте HypeDE уже сегодня!", 700, size=70, color=PRIMARY_COLOR, bold=True)
    bg = add_text_to_image(bg, "GitHub: github.com/hypede/hypede", 900, size=45, color=SECONDARY_COLOR, bold=False)
    
    # Add logo at bottom
    logo_path = os.path.join(INPUT_DIR, "logo.png")
    if os.path.exists(logo_path):
        logo = Image.open(logo_path)
        logo = logo.resize((150, int(logo.size[1] * 150 / logo.size[0])))
        logo_array = np.array(logo)
        
        logo_x = (RESOLUTION[0] - 150) // 2
        logo_y = 1600
        
        if logo_array.shape[2] == 4:
            alpha = logo_array[:, :, 3] / 255.0
            for c in range(3):
                bg[logo_y:logo_y+logo_array.shape[0], logo_x:logo_x+logo_array.shape[1], c] = (
                    bg[logo_y:logo_y+logo_array.shape[0], logo_x:logo_x+logo_array.shape[1], c] * (1 - alpha) +
                    logo_array[:, :, c] * alpha
                )
        else:
            bg[logo_y:logo_y+logo_array.shape[0], logo_x:logo_x+logo_array.shape[1]] = logo_array
    
    return bg

def process_image(image_path, index):
    """Process a single image with effects"""
    img = Image.open(image_path)
    img_array = np.array(img)
    
    # Resize to fit
    img_h, img_w = img_array.shape[:2]
    target_ratio = RESOLUTION[0] / RESOLUTION[1]
    img_ratio = img_w / img_h
    
    if img_ratio > target_ratio:
        # Image is wider, fit to width
        new_w = RESOLUTION[0]
        new_h = int(img_h * new_w / img_w)
    else:
        # Image is taller, fit to height
        new_h = RESOLUTION[1]
        new_w = int(img_w * new_h / img_h)
    
    img = img.resize((new_w, new_h))
    img_array = np.array(img)
    
    # Create background
    bg = np.zeros((RESOLUTION[1], RESOLUTION[0], 3), dtype=np.uint8)
    bg[:, :] = (20, 20, 30)
    
    # Paste image in center
    y_start = (RESOLUTION[1] - new_h) // 2
    x_start = (RESOLUTION[0] - new_w) // 2
    
    if img_array.shape[2] == 4:  # RGBA
        alpha = img_array[:, :, 3] / 255.0
        for c in range(3):
            bg[y_start:y_start+new_h, x_start:x_start+new_w, c] = (
                bg[y_start:y_start+new_h, x_start:x_start+new_w, c] * (1 - alpha) +
                img_array[:, :, c] * alpha
            )
    else:
        bg[y_start:y_start+new_h, x_start:x_start+new_w] = img_array
    
    # Add feature text
    feature_texts = {
        0: "🚀 Лаунчер",
        1: "⚙️ Настройки",
        2: "📁 Файлы",
        3: "🔒 Экран блокировки",
        4: "💡 Быстрые настройки",
        5: "🎨 AI ассистент",
        6: "📱 Панель",
    }
    
    if index in feature_texts:
        bg = add_text_to_image(bg, feature_texts[index], 1700, size=60, color=ACCENT_COLOR, bold=True)
    
    return bg

def main():
    """Main function to create the promo video"""
    print("🎬 Создаем промо-видео для HypeDE...")
    
    # Get all images from input directory
    image_files = []
    for f in os.listdir(INPUT_DIR):
        if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) and f != 'logo.png':
            image_files.append(os.path.join(INPUT_DIR, f))
    
    image_files.sort()
    print(f"📷 Найдено {len(image_files)} скриншотов")
    
    # Process images - limit to first 8 to fit in time
    frames = []
    
    # Intro frame
    intro_frame = create_intro_frame()
    intro_clip = ImageClip(intro_frame).with_duration(2.5)
    frames.append(intro_clip)
    
    # Process images
    for idx, img_path in enumerate(image_files[:8]):
        print(f"  Обрабатываем {img_path}...")
        img_array = process_image(img_path, idx)
        clip = ImageClip(img_array).with_duration(DURATION_PER_IMAGE)
        
        # Apply effects
        effects = ['zoom', 'scroll_right', 'scroll_left', 'scroll_up', 'fade']
        effect_type = effects[idx % len(effects)]
        
        if effect_type == 'zoom':
            clip = clip.with_effects([
                Resize(lambda t: 1.0 + 0.1 * np.sin(t * 2 * np.pi / DURATION_PER_IMAGE))
            ])
        elif effect_type == 'scroll_right':
            clip = clip.with_effects([
                Scroll(x_speed=-5, y_speed=0)
            ])
        elif effect_type == 'scroll_left':
            clip = clip.with_effects([
                Scroll(x_speed=5, y_speed=0)
            ])
        elif effect_type == 'scroll_up':
            clip = clip.with_effects([
                Scroll(x_speed=0, y_speed=3)
            ])
        
        clip = clip.with_effects([FadeIn(0.3), FadeOut(0.3)])
        frames.append(clip)
    
    # Outro frame
    outro_frame = create_outro_frame()
    outro_clip = ImageClip(outro_frame).with_duration(3.0)
    frames.append(outro_clip)
    
    # Concatenate all clips
    final_video = concatenate_videoclips(frames, method='compose')
    
    # Calculate total duration
    total = sum(c.duration for c in frames)
    print(f"🕒 Общая длительность: {total:.1f} секунд")
    
    # Write output
    print(f"🎥 Создаем видео: {OUTPUT_FILE}")
    final_video.write_videofile(
        OUTPUT_FILE,
        fps=FPS,
        codec='libx264',
        audio_codec='aac',
        bitrate='8000k',
        threads=4,
        preset='ultrafast',
        ffmpeg_params=[
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            '-crf', '23',
        ]
    )
    
    print(f"✅ Видео успешно создано: {OUTPUT_FILE}")
    print(f"📊 Размер: {RESOLUTION[0]}x{RESOLUTION[1]}, FPS: {FPS}")
    print(f"⏱️  Длительность: {final_video.duration:.1f} секунд")
    
    # Create thumbnail
    thumbnail_time = final_video.duration / 2
    thumbnail = final_video.get_frame(thumbnail_time)
    thumbnail_img = Image.fromarray(thumbnail)
    
    # Add title to thumbnail
    draw = ImageDraw.Draw(thumbnail_img)
    font = get_font(80, bold=True)
    bbox = draw.textbbox((0, 0), "HypeDE", font=font)
    text_width = bbox[2] - bbox[0]
    draw.text(
        ((RESOLUTION[0] - text_width) // 2, 50),
        "HypeDE",
        font=font,
        fill=TEXT_COLOR
    )
    
    thumbnail_img.save("hypede_promo_thumbnail.png")
    print(f"🖼️  Обложка сохранена: hypede_promo_thumbnail.png")

if __name__ == "__main__":
    main()
